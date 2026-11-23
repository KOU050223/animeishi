import CryptoKit
import Foundation
import Network
import dnssd
import NearbyInteraction

/// Network framework（Bonjour + peer-to-peer）で近くの端末を見つけて接続し、
/// Nearby Interaction（UWB）で距離を測る。NWListener / NWBrowser / NWConnection
/// と NISession のコールバックはすべて `queue` 上で処理するため、内部状態の
/// ロックは持たない。
final class NearbyExchangeManager: NSObject {
  static let serviceType = "_animeishi-nx._tcp"
  /// メッセージ本文の上限。hello と交換データしか流れないので小さく抑える。
  static let maxMessageBytes = 64 * 1024
  /// 交換データの暗号鍵を導く HKDF の salt。両端で同じ値を使う。
  static let payloadKeySalt = Data("animeishi-nearby-exchange-v1".utf8)

  /// JS へイベントを流す出口。モジュール側から sendEvent を差し込む。
  var emitter: ((String, [String: Any?]) -> Void)?

  private let queue = DispatchQueue(label: "dev.animeishi.nearby-exchange")
  /// この端末が公開する識別子。Bonjour のサービス名にも使い、
  /// 自分自身の広告を拾ったときの除外や二重接続の解決に使う。
  private let sessionId = UUID().uuidString
  private var displayName = ""
  private var running = false

  private var listener: NWListener?
  private var browser: NWBrowser?
  private var connections: Set<PeerConnection> = []
  private var connectionByPeerId: [String: PeerConnection] = [:]
  private var displayNameByPeerId: [String: String] = [:]
  /// 発見済みで接続中・接続済みのエンドポイント。browseResultsChanged は
  /// 何度も来るので、接続開始済みのエンドポイントには重複接続しない。
  private var pendingEndpoints: Set<NWEndpoint> = []
  private var supportsUwb = false
  /// 交換データを暗号化するための鍵交換用の秘密鍵。start のたびに作り直す。
  /// 同じ Wi-Fi にいる第三者が通信を覗いても交換トークンを読めないようにする
  /// （接続自体は暗号化していない TCP のため）。
  private var agreementKey = Curve25519.KeyAgreement.PrivateKey()

  func start(displayName: String) {
    queue.async { self.startOnQueue(displayName: displayName) }
  }

  func stop() {
    queue.async { self.stopOnQueue() }
  }

  /// 交換成立のときに自分の交換データ（QR と同じ URL）を相手 1 人だけへ送る。
  /// hello と違い、近くにいるだけの相手には流さない。
  func sendPayload(peerId: String, payload: String) {
    queue.async {
      guard self.running, let peer = self.connectionByPeerId[peerId],
        let key = self.payloadKey(for: peer),
        let sealed = try? ChaChaPoly.seal(Data(payload.utf8), using: key)
      else { return }
      self.send(peer, [
        "sessionId": self.sessionId,
        "type": "payload",
        "box": sealed.combined.base64EncodedString(),
      ])
    }
  }

  static func isPreciseDistanceSupported() -> Bool {
    // Expo Modules の最低 iOS が 16.4 なので、16 以降の API だけで判定する。
    NISession.deviceCapabilities.supportsPreciseDistanceMeasurement
  }

  private func emit(_ event: String, _ payload: [String: Any?]) {
    emitter?(event, payload)
  }

  private func startOnQueue(displayName: String) {
    if running { return }
    running = true
    self.displayName = displayName
    agreementKey = Curve25519.KeyAgreement.PrivateKey()

    supportsUwb = Self.isPreciseDistanceSupported()
    emit("onCapability", ["uwb": supportsUwb])

    startListener()
    startBrowser()
  }

  private func stopOnQueue() {
    guard running else { return }
    running = false

    listener?.cancel()
    listener = nil
    browser?.cancel()
    browser = nil

    for connection in connections {
      connection.niSession?.invalidate()
      connection.niSession = nil
      connection.connection.cancel()
    }
    connections.removeAll()
    connectionByPeerId.removeAll()
    displayNameByPeerId.removeAll()
    pendingEndpoints.removeAll()
  }

  // MARK: - 発見と接続（Network framework）

  /// Wi-Fi ルーターを介さない端末間（AWDL）でもつながるよう、待ち受け・探索・
  /// 接続のすべてで peer-to-peer を有効にする。
  private static func peerToPeerParameters() -> NWParameters {
    let params = NWParameters.tcp
    params.includePeerToPeer = true
    return params
  }

  private func startListener() {
    do {
      let listener = try NWListener(using: Self.peerToPeerParameters())
      listener.service = NWListener.Service(name: sessionId, type: Self.serviceType)
      listener.stateUpdateHandler = { [weak self] state in
        if case .failed(let error) = state {
          self?.emit("onError", ["code": "listener_failed", "message": error.localizedDescription])
        }
      }
      listener.newConnectionHandler = { [weak self] connection in
        self?.accept(connection, isInbound: true)
      }
      listener.start(queue: queue)
      self.listener = listener
    } catch {
      emit("onError", ["code": "listener_failed", "message": error.localizedDescription])
    }
  }

  private func startBrowser() {
    let browser = NWBrowser(
      for: .bonjour(type: Self.serviceType, domain: nil), using: Self.peerToPeerParameters())
    browser.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed(let error):
        self?.emit("onError", ["code": "browser_failed", "message": error.localizedDescription])
      case .waiting(let error):
        // ローカルネットワークの許可が拒否されていると、失敗ではなく
        // PolicyDenied の waiting で止まり続ける。
        if case .dns(let code) = error, code == DNSServiceErrorType(kDNSServiceErr_PolicyDenied) {
          self?.emit("onError", ["code": "local_network_denied", "message": error.localizedDescription])
        }
      default:
        break
      }
    }
    browser.browseResultsChangedHandler = { [weak self] results, _ in
      self?.handleBrowseResults(results)
    }
    browser.start(queue: queue)
    self.browser = browser
  }

  private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
    guard running else { return }
    for result in results {
      guard case .service(let name, _, _, _) = result.endpoint else { continue }
      // 自分自身の広告と、接続開始済みのエンドポイントは除外する。
      if name == sessionId || pendingEndpoints.contains(result.endpoint) { continue }
      pendingEndpoints.insert(result.endpoint)
      accept(
        NWConnection(to: result.endpoint, using: Self.peerToPeerParameters()), isInbound: false)
    }
  }

  private func accept(_ connection: NWConnection, isInbound: Bool) {
    let peer = PeerConnection(connection: connection, isInbound: isInbound)
    connections.insert(peer)
    connection.stateUpdateHandler = { [weak self] state in
      self?.handleConnectionState(peer, state)
    }
    connection.start(queue: queue)
    receiveNext(peer)
  }

  private func handleConnectionState(_ peer: PeerConnection, _ state: NWConnection.State) {
    switch state {
    case .ready:
      // NI のトークンは NISession ごとの識別子なので、この接続の相手と
      // 測るセッションを接続ごとに作り、そのセッションのトークンを送る。
      if supportsUwb {
        peer.niSession = makeSession()
      }
      sendHello(peer)
    case .failed(let error):
      // 二重接続で不要側を捨てた・相手側が捨てた場合の切断はエラーにしない。
      let wasRegistered = peer.peerId.map { connectionByPeerId[$0] === peer } ?? false
      if wasRegistered || (peer.peerId == nil && !peer.isInbound) {
        emit("onError", ["code": "connection_failed", "message": error.localizedDescription])
      }
      teardown(peer)
    case .cancelled:
      teardown(peer)
    default:
      break
    }
  }

  private func teardown(_ peer: PeerConnection) {
    guard connections.remove(peer) != nil else { return }
    pendingEndpoints.remove(peer.connection.endpoint)
    peer.niSession?.invalidate()
    peer.niSession = nil
    if let peerId = peer.peerId, connectionByPeerId[peerId] === peer {
      connectionByPeerId.removeValue(forKey: peerId)
      displayNameByPeerId.removeValue(forKey: peerId)
      if running {
        emit("onPeerLost", ["peerId": peerId])
      }
    }
  }

  // MARK: - メッセージ送受信（長さプレフィックス付き JSON）

  private func sendHello(_ peer: PeerConnection) {
    var hello: [String: Any] = [
      "sessionId": sessionId,
      "displayName": displayName,
      // 相手が UWB 非対応なら、10cm の測定ではなくタップの申し込みで交換する。
      "uwb": supportsUwb,
      "pubKey": agreementKey.publicKey.rawRepresentation.base64EncodedString(),
    ]
    if let token = peer.niSession?.discoveryToken,
      let data = try? NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true)
    {
      hello["niToken"] = data.base64EncodedString()
    }
    send(peer, hello)
  }

  private func send(_ peer: PeerConnection, _ message: [String: Any]) {
    guard let body = try? JSONSerialization.data(withJSONObject: message),
      body.count <= Self.maxMessageBytes
    else { return }
    var length = UInt32(body.count).bigEndian
    var framed = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
    framed.append(body)
    peer.connection.send(content: framed, completion: .contentProcessed { _ in })
  }

  private func receiveNext(_ peer: PeerConnection) {
    peer.connection.receive(minimumIncompleteLength: 4, maximumLength: 4) {
      [weak self] header, _, isComplete, error in
      guard let self, let header, header.count == 4, error == nil, !isComplete else {
        self?.teardown(peer)
        return
      }
      let length = Int(UInt32(bigEndian: header.withUnsafeBytes { $0.load(as: UInt32.self) }))
      guard length > 0, length <= Self.maxMessageBytes else {
        peer.connection.cancel()
        return
      }
      peer.connection.receive(minimumIncompleteLength: length, maximumLength: length) {
        [weak self] body, _, isComplete, error in
        guard let self, let body, body.count == length, error == nil, !isComplete else {
          self?.teardown(peer)
          return
        }
        if let message = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
          self.handleMessage(peer, message)
        }
        self.receiveNext(peer)
      }
    }
  }

  private func handleMessage(_ peer: PeerConnection, _ message: [String: Any]) {
    guard running, let peerId = message["sessionId"] as? String, peerId != sessionId else { return }

    if message["type"] as? String == "payload" {
      // hello を受け取って登録済みの接続から来た交換データだけを受け付ける。
      guard peer.peerId == peerId, connectionByPeerId[peerId] === peer,
        let boxBase64 = message["box"] as? String,
        let boxData = Data(base64Encoded: boxBase64),
        let key = payloadKey(for: peer),
        let sealed = try? ChaChaPoly.SealedBox(combined: boxData),
        let opened = try? ChaChaPoly.open(sealed, using: key),
        let payload = String(data: opened, encoding: .utf8)
      else { return }
      emit("onPayload", ["peerId": peerId, "payload": payload])
      return
    }

    peer.peerId = peerId

    if let existing = connectionByPeerId[peerId], existing !== peer {
      // お互いが広告・探索するため 1 組の端末間に接続が 2 本できうる。
      // sessionId の大小で残す側を決定し、両端で同じ接続を残す
      // （大きい側の outbound = 小さい側の inbound）。
      if shouldPrefer(peer, over: existing, peerId: peerId) {
        existing.connection.cancel()
        connectionByPeerId[peerId] = peer
      } else {
        peer.connection.cancel()
        return
      }
    } else {
      connectionByPeerId[peerId] = peer
    }

    if let pubKeyBase64 = message["pubKey"] as? String,
      let pubKeyData = Data(base64Encoded: pubKeyBase64)
    {
      peer.peerPublicKey = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: pubKeyData)
    }

    let name = message["displayName"] as? String ?? ""
    if displayNameByPeerId[peerId] == nil {
      emit("onPeerFound", [
        "peerId": peerId, "displayName": name, "uwb": message["uwb"] as? Bool ?? false,
      ])
    }
    displayNameByPeerId[peerId] = name

    if let tokenBase64 = message["niToken"] as? String,
      let data = Data(base64Encoded: tokenBase64)
    {
      handlePeerToken(peer, data: data)
    }
  }

  private func shouldPrefer(_ candidate: PeerConnection, over _: PeerConnection, peerId: String) -> Bool {
    // 自分の sessionId が相手より大きいときは outbound、小さいときは inbound を残す。
    let preferInbound = sessionId < peerId
    return candidate.isInbound == preferInbound
  }

  /// 自分の秘密鍵と相手の公開鍵から、この相手との交換データ用の共通鍵を導く。
  /// 両端で同じ鍵になる（X25519 の共有秘密 → HKDF）。
  private func payloadKey(for peer: PeerConnection) -> SymmetricKey? {
    guard let peerPublicKey = peer.peerPublicKey,
      let shared = try? agreementKey.sharedSecretFromKeyAgreement(with: peerPublicKey)
    else { return nil }
    return shared.hkdfDerivedSymmetricKey(
      using: SHA256.self, salt: Self.payloadKeySalt, sharedInfo: Data(), outputByteCount: 32)
  }

  // MARK: - 距離の測定（Nearby Interaction）

  private func makeSession() -> NISession {
    let session = NISession()
    session.delegate = self
    // 状態の読み書きを 1 本のキューに揃える（既定はメインキュー）。
    session.delegateQueue = queue
    return session
  }

  private func handlePeerToken(_ peer: PeerConnection, data: Data) {
    do {
      guard let token = try NSKeyedUnarchiver.unarchivedObject(
        ofClass: NIDiscoveryToken.self, from: data
      ) else { return }
      peer.peerToken = token
      runNearbySession(peer)
    } catch {
      emit("onError", ["code": "ni_token_invalid", "message": error.localizedDescription])
    }
  }

  private func runNearbySession(_ peer: PeerConnection) {
    guard supportsUwb, let session = peer.niSession, let token = peer.peerToken else { return }
    session.run(NINearbyPeerConfiguration(peerToken: token))
  }

  private func peer(for session: NISession) -> PeerConnection? {
    connections.first { $0.niSession === session }
  }
}

final class PeerConnection: Hashable {
  let connection: NWConnection
  let isInbound: Bool
  /// hello を受信するまでは不明。相手の sessionId が入る。
  var peerId: String?
  /// この接続の相手と距離を測るセッション。hello で送るトークンもこれのもの。
  var niSession: NISession?
  /// 相手が hello で送ってきた、相手側セッションのトークン。
  var peerToken: NIDiscoveryToken?
  /// 交換データの暗号化に使う相手の公開鍵。
  var peerPublicKey: Curve25519.KeyAgreement.PublicKey?

  init(connection: NWConnection, isInbound: Bool) {
    self.connection = connection
    self.isInbound = isInbound
  }

  static func == (lhs: PeerConnection, rhs: PeerConnection) -> Bool {
    lhs === rhs
  }

  func hash(into hasher: inout Hasher) {
    hasher.combine(ObjectIdentifier(self))
  }
}

extension NearbyExchangeManager: NISessionDelegate {
  func session(_ session: NISession, didUpdate nearbyObjects: [NINearbyObject]) {
    guard let peer = peer(for: session), let peerId = peer.peerId else { return }
    for object in nearbyObjects {
      var payload: [String: Any?] = ["peerId": peerId]
      payload["meters"] = object.distance.map { Double($0) } ?? NSNull()
      if let direction = object.direction {
        payload["direction"] = [
          "x": Double(direction.x),
          "y": Double(direction.y),
          "z": Double(direction.z),
        ]
      }
      emit("onDistance", payload)
    }
  }

  func session(_ session: NISession, didRemove nearbyObjects: [NINearbyObject], reason: NINearbyObject.RemovalReason) {
    guard let peer = peer(for: session), let peerId = peer.peerId, !nearbyObjects.isEmpty else { return }
    emit("onDistance", ["peerId": peerId, "meters": NSNull()])
  }

  func sessionWasSuspended(_ session: NISession) {}

  func sessionSuspensionEnded(_ session: NISession) {
    // 中断から復帰したセッションは run を呼び直さないと測定が再開しない。
    guard let peer = peer(for: session) else { return }
    runNearbySession(peer)
  }

  func session(_ session: NISession, didInvalidateWith error: Error) {
    // 停止・切断で自分から invalidate したセッションは接続から外れている。
    guard running, let peer = peer(for: session) else { return }
    peer.niSession = nil
    if (error as? NIError)?.code == .userDidNotAllow {
      // 許可が拒否された。作り直しても同じエラーで無効化され続けるため
      // 測定をやめて JS に知らせる（QR へのフォールバックは JS 側）。
      supportsUwb = false
      for other in connections {
        other.niSession?.invalidate()
        other.niSession = nil
      }
      emit("onError", ["code": "ni_permission_denied", "message": error.localizedDescription])
      return
    }
    emit("onError", ["code": "ni_invalidated", "message": error.localizedDescription])
    // 新しいセッションを立て直し、新しいトークンを相手へ送り直してから、
    // 手元にある相手のトークンで測定を再開する。
    peer.niSession = makeSession()
    sendHello(peer)
    runNearbySession(peer)
  }
}

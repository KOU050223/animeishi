import ExpoModulesCore

struct NearbyExchangeStartOptions: Record {
  @Field var displayName: String = ""
}

struct NearbyExchangeSendOptions: Record {
  @Field var peerId: String = ""
  @Field var payload: String = ""
}

public class NearbyExchangeModule: Module {
  private let manager = NearbyExchangeManager()

  public func definition() -> ModuleDefinition {
    Name("NearbyExchange")

    Events("onPeerFound", "onPeerLost", "onDistance", "onError", "onCapability", "onPayload")

    OnCreate {
      manager.emitter = { [weak self] event, payload in
        self?.sendEvent(event, payload)
      }
    }

    OnDestroy {
      manager.stop()
    }

    Function("start") { (options: NearbyExchangeStartOptions) in
      manager.start(displayName: options.displayName)
    }

    Function("stop") {
      manager.stop()
    }

    Function("sendPayload") { (options: NearbyExchangeSendOptions) in
      manager.sendPayload(peerId: options.peerId, payload: options.payload)
    }

    Function("isSupported") { () -> Bool in
      NearbyExchangeManager.isPreciseDistanceSupported()
    }
  }
}

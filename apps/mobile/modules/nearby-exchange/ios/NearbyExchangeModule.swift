import ExpoModulesCore

struct NearbyExchangeStartOptions: Record {
  @Field var displayName: String = ""
}

public class NearbyExchangeModule: Module {
  private let manager = NearbyExchangeManager()

  public func definition() -> ModuleDefinition {
    Name("NearbyExchange")

    Events("onPeerFound", "onPeerLost", "onDistance", "onError", "onCapability")

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
  }
}

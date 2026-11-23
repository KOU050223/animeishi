import { NativeModule, requireOptionalNativeModule } from "expo";

import type {
  NearbyExchangeModuleEvents,
  NearbyExchangeSendOptions,
  NearbyExchangeStartOptions,
} from "./NearbyExchange.types";

declare class NearbyExchangeModule extends NativeModule<NearbyExchangeModuleEvents> {
  start(options: NearbyExchangeStartOptions): void;
  stop(): void;
  // 試作（#700）のビルドには無いので optional にしておく。
  sendPayload?(options: NearbyExchangeSendOptions): void;
  isSupported?(): boolean;
}

// 「QR・フレンド」タブから常に読み込まれるため、モジュールを含まない
// ビルド（Expo Go・古い開発ビルド）でも import 時に落とさず null にする。
export default requireOptionalNativeModule<NearbyExchangeModule>(
  "NearbyExchange",
);

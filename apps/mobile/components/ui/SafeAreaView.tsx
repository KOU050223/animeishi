import { styled } from "react-native-css";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";

/**
 * className を受け付ける SafeAreaView。
 *
 * react-native-css の Metro resolver は react-native-safe-area-context の
 * import を差し替えるが、styled() で包まれるのは SafeAreaProvider だけで
 * SafeAreaView は素のまま再エクスポートされる。className を効かせるには
 * 呼び出し側で styled() に通す必要がある。
 */
export const SafeAreaView = styled(RNSafeAreaView);

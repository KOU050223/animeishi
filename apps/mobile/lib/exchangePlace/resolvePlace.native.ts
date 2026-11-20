import * as Location from "expo-location";
import type { ResolvePlaceName } from "./types";

/**
 * 「場所を残す」が押されたときだけ呼ばれる位置解決（issue #661）。
 * 権限要求はここで初めて行い、交換成立時点では要求しない。
 * 座標は逆ジオコーディングで地名テキストに変換した時点で捨て、
 * 戻り値にも state にも持たせない。
 */
export const resolvePlaceName: ResolvePlaceName = async () => {
  try {
    // 権限要求も try の内側。ネイティブ側で例外が起きても
    // 「取得できなかった」に畳み込み、呼び出し側の案内に繋げる。
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) {
      return { kind: "denied" };
    }

    // 低精度で十分（地名・施設名まで取れればよい。正確な座標は不要）。
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Low,
    });
    const places = await Location.reverseGeocodeAsync(position.coords);
    const place = places[0];
    if (!place) return { kind: "unavailable" };

    // 施設名（name）を優先し、なければ市区町村〜国の組み立てに落とす。
    // 重複パーツは除く（name が city と同じとき等）。
    const name =
      place.name && place.name !== place.city
        ? place.name
        : [place.city, place.region, place.country]
            .filter((p): p is string => !!p)
            .join(" ") || null;
    return name ? { kind: "ok", name } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
};

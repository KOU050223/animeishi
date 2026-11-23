import type { TFunction } from "i18next";
import { proximityLevel } from "@/lib/nearbyExchange";
import type { StagePhase } from "./NearbyExchangeStage";

/** 近づけて交換の画面下に出す案内（見出しと補足）。 */
export function nearbyHint(
  t: TFunction,
  {
    phase,
    peerName,
    meters,
    received,
    landed,
    registering,
    tapPeersOnly = false,
  }: {
    phase: StagePhase;
    peerName: string;
    /** 主役の相手までの距離。測れていなければ null。 */
    meters: number | null;
    /** 入れ替わり中に相手のデータが届いたか。 */
    received: boolean;
    /** 相手の名刺が着地したか。 */
    landed: boolean;
    /** 着地後、まだ登録の応答を待っているか。 */
    registering: boolean;
    /** 近づけて交換できる相手がおらず、タップで交換する相手だけがいる。 */
    tapPeersOnly?: boolean;
  },
): { title: string; subtitle: string } {
  if (phase === "search" && tapPeersOnly) {
    return {
      title: t("相手をタップして交換を申し込めます"),
      subtitle: t("相手が承認すると、名刺が入れ替わります"),
    };
  }
  if (phase === "search") {
    return {
      title: t("近くの人を探しています"),
      subtitle: t("相手にも「近づける」を開いてもらってください"),
    };
  }
  if (phase === "found") {
    if (meters == null) {
      return {
        title: t("{{name}}さんが見つかりました", { name: peerName }),
        subtitle: t("iPhone の上の端どうしを近づけてください"),
      };
    }
    switch (proximityLevel(meters)) {
      case "far":
        return {
          title: t("もっと近づけて"),
          subtitle: t("iPhone の上の端どうしを近づけてください"),
        };
      case "near":
        return {
          title: t("その調子"),
          subtitle: t("上の端の光が強くなったら、あと少しです"),
        };
      default:
        return {
          title: t("あと少し"),
          subtitle: t("端どうしが触れるくらいまで"),
        };
    }
  }
  if (landed) {
    return {
      title: t("交換成立"),
      subtitle: registering
        ? t("登録しています…")
        : t("{{name}}さんの名刺を受け取りました", { name: peerName }),
    };
  }
  if (received) {
    return {
      title: t("{{name}}さんの名刺が届きました", { name: peerName }),
      subtitle: "",
    };
  }
  return {
    title: t("あなたの名刺を {{name}}さんへ", { name: peerName }),
    subtitle: t("上の端から相手の iPhone へ"),
  };
}

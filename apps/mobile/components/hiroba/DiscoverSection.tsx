import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SegmentedControl } from "@/components/ui";
import { DiscoverWorkLists } from "@/features/work-lists/components/DiscoverWorkLists";
import { DiscoverTierLists } from "@/features/tier-lists/components/DiscoverTierLists";
import { DiscoverUsers } from "./DiscoverUsers";

// ひろばタブの「みつける」セクション。
// 公開作品リスト（issue #422）に加えて、公開 tier 表と公開名刺
// （issue #418）を同じ並びに置く。対象ごとにフィードを切り替え、
// 並び替え・いいね・通報の UI は各フィードが持つ。
// target は URL パラメータで制御し、フィードの空状態から
// 名刺一覧へ直接誘導できるようにする（issue #533）。
const TARGETS = ["work-lists", "tier-lists", "users"] as const;
type DiscoverTarget = (typeof TARGETS)[number];

function isTarget(value: unknown): value is DiscoverTarget {
  return TARGETS.includes(value as DiscoverTarget);
}

export function DiscoverSection() {
  const router = useRouter();
  const params = useLocalSearchParams<{ target?: string }>();
  const target = isTarget(params.target) ? params.target : "work-lists";
  const setTarget = (next: DiscoverTarget) =>
    router.setParams({ target: next });

  return (
    <View className="flex-1" testID="hiroba-discover-section">
      <SegmentedControl
        items={[
          {
            label: "作品リスト",
            active: target === "work-lists",
            onPress: () => setTarget("work-lists"),
            testID: "hiroba-discover-target-work-lists",
          },
          {
            label: "Tier 表",
            active: target === "tier-lists",
            onPress: () => setTarget("tier-lists"),
            testID: "hiroba-discover-target-tier-lists",
          },
          {
            label: "名刺",
            active: target === "users",
            onPress: () => setTarget("users"),
            testID: "hiroba-discover-target-users",
          },
        ]}
      />
      {target === "work-lists" ? (
        <DiscoverWorkLists />
      ) : target === "tier-lists" ? (
        <DiscoverTierLists />
      ) : (
        <DiscoverUsers />
      )}
    </View>
  );
}

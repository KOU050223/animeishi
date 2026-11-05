import { useState } from "react";
import { View } from "react-native";
import { SegmentedControl } from "@/components/ui";
import { DiscoverWorkLists } from "./DiscoverWorkLists";
import { DiscoverTierLists } from "./DiscoverTierLists";
import { DiscoverUsers } from "./DiscoverUsers";

// ひろばタブの「みつける」セクション。
// 公開作品リスト（issue #422）に加えて、公開 tier 表と公開名刺
// （issue #418）を同じ並びに置く。対象ごとにフィードを切り替え、
// 並び替え・いいね・通報の UI は各フィードが持つ。
type DiscoverTarget = "work-lists" | "tier-lists" | "users";

export function DiscoverSection() {
  const [target, setTarget] = useState<DiscoverTarget>("work-lists");

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

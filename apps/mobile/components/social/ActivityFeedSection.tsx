import { View } from "react-native";
import { ActivityFeedList } from "./ActivityFeedList";
import type { ActivityFeedListProps } from "./ActivityFeedList";

// 画面上部の safe area とセクション切り替えはタブ画面側が持つため、
// ここではセクション名の見出しを出さない。
export function ActivityFeedSection(props: ActivityFeedListProps) {
  return (
    <View
      className="flex-1 bg-white dark:bg-slate-900"
      testID="activity-feed-section"
    >
      <ActivityFeedList {...props} />
    </View>
  );
}

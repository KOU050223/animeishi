import { View } from "react-native";
import { Skeleton, SkeletonGroup } from "./Skeleton";

export function ListLoadingSkeleton({
  accessibilityLabel,
}: {
  accessibilityLabel: string;
}) {
  return (
    <SkeletonGroup
      className="w-full px-4 py-4"
      accessibilityLabel={accessibilityLabel}
      testID="list-loading-skeleton"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <View key={index} className="flex-row items-center gap-3 py-3">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-3 w-4/5 rounded" />
            <Skeleton className="h-3 w-2/5 rounded" muted />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

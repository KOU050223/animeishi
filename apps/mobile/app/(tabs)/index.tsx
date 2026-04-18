import { useAuth } from "@clerk/clerk-expo";
import { View, Text, TouchableOpacity } from "react-native";

export default function HomeScreen() {
  const { signOut } = useAuth();

  return (
    <View className="flex-1 items-center justify-center bg-white">
      <Text className="text-2xl font-bold text-gray-900 mb-4">
        Animeishi へようこそ
      </Text>
      <TouchableOpacity
        className="bg-gray-200 rounded-lg px-6 py-3"
        onPress={() => signOut()}
        testID="sign-out-button"
        accessibilityRole="button"
        accessibilityLabel="サインアウト"
      >
        <Text className="text-gray-700 font-semibold">サインアウト</Text>
      </TouchableOpacity>
    </View>
  );
}

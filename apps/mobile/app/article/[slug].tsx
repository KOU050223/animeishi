import { useLocalSearchParams } from "expo-router";
import {
  ArticleScreen,
  type ArticleScreenParams,
} from "@/features/articles/screens/ArticleScreen";

export default function ArticleRoute() {
  const params = useLocalSearchParams<ArticleScreenParams>();
  return <ArticleScreen params={params} />;
}

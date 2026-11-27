import {
  MeishiCard,
  type MeishiCardProps,
} from "@/features/meishi/components/MeishiCard";

export function ProfileMeishiPreview(props: MeishiCardProps) {
  return <MeishiCard {...props} zoomable />;
}

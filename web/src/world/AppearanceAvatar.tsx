import { avatarLook } from "../../../shared/appearance";
import { ProfileSprite } from "./ProfileSprite";
import "./appearance.css";
export function AppearanceAvatar({ id }: { id?: string }) {
  const look = avatarLook(id);
  return look ? (
    <span className="appearance-avatar" data-appearance-avatar={id}>
      <ProfileSprite look={look} scale={1} />
    </span>
  ) : null;
}

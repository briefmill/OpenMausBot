import { setShowThreads, useShowThreadsChoice } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import { Switch } from "./SettingsPrimitives";

export function SidebarThreadsControl() {
  const visible = useShowThreadsChoice();
  return <label className="ui-pill gap-2">
    {t("chat.activity.sidebarThreads")}
    <Switch aria-label={t("chat.activity.sidebarThreads")} checked={visible} onClick={() => setShowThreads(!visible)} />
  </label>;
}

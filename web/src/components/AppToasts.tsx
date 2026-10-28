import { createPortal } from "react-dom";
import { store } from "../store";
import type { Notice, UpdateInfo } from "../store/types";
import { CloseButton } from "./CloseButton";
import { NoticeDetail, ToastMark } from "./NoticeContent";
import { StaleBuildToast, useStaleBuild } from "./StaleBuildToast";
import { Toast } from "./Toast";
import { UpdateToast } from "./UpdateToast";

/** The application's toast stack: update, newer build and the current notice. */
export function AppToasts({
  status,
  updateInfo,
  dismissedUpdateVersion,
  updateInstalling,
  notice,
  onNoticeAction,
}: {
  status: string;
  updateInfo: UpdateInfo | null;
  dismissedUpdateVersion: string | null;
  updateInstalling: boolean;
  notice: Notice | null;
  onNoticeAction: (notice: Notice) => void;
}) {
  const staleBuild = useStaleBuild(status);
  if (!updateInfo?.update_available && !notice && !staleBuild) return null;
  return createPortal(
    <div className="toast-viewport" aria-live="polite">
      <UpdateToast
        info={updateInfo}
        dismissedVersion={dismissedUpdateVersion}
        installing={updateInstalling}
        onDismiss={() => store.dismissUpdate()}
        onInstall={() => {
          void store.installUpdate();
        }}
      />
      {staleBuild ? <StaleBuildToast {...staleBuild} /> : null}
      {notice ? (
        <Toast
          className={`toast toast-${notice.kind} ${
            notice.loading ? "toast-loading" : ""
          }`}
          role={notice.kind === "error" ? "alert" : "status"}
          notificationKey={notice.id}
          onDismiss={() => {
            // Swipes dismiss after their exit animation; keep any
            // newer notice that replaced this one meanwhile.
            if (store.get().notice?.id === notice.id) store.clearNotice();
          }}
        >
          <ToastMark kind={notice.kind} loading={notice.loading} />
          <div className="toast-content">
            <strong>{notice.message}</strong>
            <NoticeDetail notice={notice} />
            {notice.actionLabel &&
            (notice.actionPaneId ||
              notice.actionWorkspaceId ||
              notice.actionClipboardText !== undefined) ? (
              <div className="toast-actions">
                <button
                  type="button"
                  className="toast-action primary"
                  onClick={() => onNoticeAction(notice)}
                >
                  {notice.actionLabel}
                </button>
              </div>
            ) : null}
          </div>
          <CloseButton
            variant="toast"
            label="Dismiss notification"
            onClick={() => store.clearNotice()}
          />
        </Toast>
      ) : null}
    </div>,
    document.body,
  );
}

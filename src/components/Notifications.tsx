import React, { useSyncExternalStore } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';
import { dismissNotice, getNotices, subscribeNotices } from '../services/notifications';

/** The notices raised with notify(), stacked under the header on the right */
export const Notifications: React.FC = () => {
  const notices = useSyncExternalStore(subscribeNotices, getNotices);

  return (
    <div className="fixed top-16 right-4 z-[60] flex flex-col items-end space-y-2 pointer-events-none">
      {notices.map((notice) => {
        const isError = notice.kind === 'error';
        return (
          <div
            key={notice.id}
            role={isError ? 'alert' : 'status'}
            className={`pointer-events-auto w-80 max-w-[calc(100vw-2rem)] rounded-lg border p-3 text-xs shadow-2xl flex items-start space-x-2 ${
              isError
                ? 'bg-[#2a1214] border-[#7f2a2a] text-red-100'
                : 'bg-[#141b26] border-[#2c3747] text-[#E6E4DF]'
            }`}
          >
            {isError ? (
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            ) : (
              <Info className="w-4 h-4 text-[#60A5FA] shrink-0 mt-0.5" />
            )}
            <span className="flex-1 leading-relaxed whitespace-pre-line break-words">{notice.message}</span>
            <button
              onClick={() => dismissNotice(notice.id)}
              className="shrink-0 text-gray-400 hover:text-white transition-colors"
              title="閉じる"
              aria-label="通知を閉じる"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const ToastContext = createContext(() => {});

export const useToast = () => useContext(ToastContext);

const NOTICES = {
  confirmed: ["You're subscribed. Alerts arrive when Office.js changes.", false],
  unsubscribed: ["Unsubscribed. No more alerts.", false],
  "invalid-link": ["That link is not valid anymore.", true],
};

/** Shows ?notice=… left by the confirm/unsubscribe redirects, then cleans the URL. */
function NoticeFromUrl({ show }) {
  const params = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const notice = NOTICES[params.get("notice")];
    if (!notice) return;
    show(...notice);
    router.replace("/", { scroll: false });
  }, [params, router, show]);
  return null;
}

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef();
  const show = useCallback((message, error = false) => {
    setToast({ message, error, key: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <Suspense fallback={null}>
        <NoticeFromUrl show={show} />
      </Suspense>
      {toast && (
        <div key={toast.key} className={`toast${toast.error ? " error" : ""}`} role="status">
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

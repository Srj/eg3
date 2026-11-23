import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { getOrCreateStore, StoreConfig } from "./createStore";
import { useEffect, useMemo } from "react";

export interface AppProviderProps {
  children: React.ReactNode;
  storeConfig?: StoreConfig;
}

export default function AppProvider({
  children,
  storeConfig,
}: AppProviderProps) {
  const storeId = storeConfig?.storeId;
  const enablePersistence = storeConfig?.enablePersistence;

  const { store, persistor } = useMemo(
    () => getOrCreateStore({ storeId, enablePersistence }),
    [storeId, enablePersistence]
  );

  // State is written to storage at most once a second; write it right away
  // when the page is reloaded, closed or hidden, so the last change (e.g. a
  // Samples Apply just before a reload) isn't lost.
  useEffect(() => {
    if (!persistor) return;
    const flush = () => void persistor.flush();
    const onHidden = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [persistor]);

  if (!persistor) {
    // No persistence enabled, use plain Provider
    return <Provider store={store}>{children}</Provider>;
  }

  return (
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        {children}
      </PersistGate>
    </Provider>
  );
}

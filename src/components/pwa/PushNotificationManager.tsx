"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

type PushSubscriptionKeys = {
  p256dh: string;
  auth: string;
};

type PushSubscriptionData = {
  endpoint: string;
  keys: PushSubscriptionKeys;
};

type SubscriptionStatus = "unsupported" | "default" | "granted" | "denied" | "pending" | "subscribed";

export function usePushNotifications() {
  const { session } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    checkSupportAndStatus();
  }, [session]);

  const checkSupportAndStatus = useCallback(async () => {
    if (!session?.user) {
      setStatus("default");
      setIsSubscribed(false);
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }

    if (!("Notification" in window)) {
      setStatus("unsupported");
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      setSwRegistration(registration);

      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        setIsSubscribed(true);
        setStatus("subscribed");
      } else {
        const permission = Notification.permission;
        setStatus(permission);
      }
    } catch (err) {
      console.error("[Push] Failed to check subscription status:", err);
      setStatus("default");
    }
  }, [session]);

  const requestPermissionAndSubscribe = useCallback(async (): Promise<boolean> => {
    if (!session?.user) {
      setError("Oturum bulunamadı.");
      return false;
    }

    if (!swRegistration) {
      setError("Service Worker hazır değil.");
      return false;
    }

    if (Notification.permission === "denied") {
      setError("Bildirim izni reddedildi. Tarayıcı ayarlarından izin verebilirsiniz.");
      setStatus("denied");
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const permission = await Notification.requestPermission();
      
      if (permission !== "granted") {
        setError("Bildirim izni verilmedi.");
        setStatus(permission);
        setLoading(false);
        return false;
      }

      setStatus("pending");

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        throw new Error("VAPID public key not configured");
      }

      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

      const subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const subscriptionData: PushSubscriptionData = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(subscription.getKey("p256dh")!),
          auth: arrayBufferToBase64(subscription.getKey("auth")!),
        },
      };

      const accessToken = session.access_token;
      const response = await fetch("/api/push/subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(subscriptionData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Abonelik kaydedilemedi");
      }

      setIsSubscribed(true);
      setStatus("subscribed");
      setLoading(false);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Abonelik sırasında hata oluştu";
      setError(message);
      setStatus("default");
      setLoading(false);
      return false;
    }
  }, [session, swRegistration]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!session?.user || !swRegistration) return false;

    setLoading(true);
    setError(null);

    try {
      const subscription = await swRegistration.pushManager.getSubscription();
      
      if (subscription) {
        await subscription.unsubscribe();
      }

      const accessToken = session.access_token;
      const response = await fetch(`/api/push/subscription?endpoint=${encodeURIComponent(subscription?.endpoint || "")}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Abonelik iptal edilemedi");
      }

      setIsSubscribed(false);
      setStatus("granted");
      setLoading(false);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Abonelik iptal edilirken hata oluştu";
      setError(message);
      setLoading(false);
      return false;
    }
  }, [session, swRegistration]);

  const toggleSubscription = useCallback(async () => {
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await requestPermissionAndSubscribe();
    }
  }, [isSubscribed, requestPermissionAndSubscribe, unsubscribe]);

  return {
    status,
    isSubscribed,
    loading,
    error,
    requestPermissionAndSubscribe,
    unsubscribe,
    toggleSubscription,
    isSupported: status !== "unsupported",
  };
}

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function getStatusLabel(status: SubscriptionStatus): string {
  switch (status) {
    case "unsupported":
      return "Desteklenmiyor";
    case "default":
      return "İzin Bekleniyor";
    case "granted":
      return "İzin Verildi";
    case "denied":
      return "Reddedildi";
    case "pending":
      return "Abonelik Oluşturuluyor...";
    case "subscribed":
      return "Bildirimler Açık";
    default:
      return "Bilinmiyor";
  }
}

export function getStatusColor(status: SubscriptionStatus): "gold" | "neutral" | "red" {
  switch (status) {
    case "subscribed":
      return "gold";
    case "granted":
      return "neutral";
    case "denied":
      return "red";
    case "unsupported":
      return "neutral";
    default:
      return "neutral";
  }
}
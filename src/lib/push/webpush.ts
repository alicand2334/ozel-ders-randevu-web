import webpush from "web-push";
import { createServiceClient } from "@/lib/supabase/server-client";

let initialized = false;

function initWebPush(): void {
  if (initialized) return;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@ozeldersrandevu.com";

  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys are not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in environment.");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  initialized = true;
}

export type PushSubscriptionData = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  type: string;
  tag?: string;
  renotify?: boolean;
  requireInteraction?: boolean;
  url?: string;
  appointment_id?: string;
  homework_id?: string;
  data?: Record<string, unknown>;
};

function toWebPushSubscription(sub: PushSubscriptionData): webpush.PushSubscription {
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  };
}

export async function getActiveSubscriptions(userId: string): Promise<PushSubscriptionData[]> {
  const admin = createServiceClient();
  
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    console.error("[Push] Failed to fetch subscriptions:", error);
    return [];
  }

  return (data ?? []) as PushSubscriptionData[];
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number; errors: string[] }> {
  initWebPush();

  const subscriptions = await getActiveSubscriptions(userId);
  
  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, errors: ["No active subscriptions"] };
  }

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    type: payload.type,
    tag: payload.tag || `odr-${payload.type}-${Date.now()}`,
    renotify: payload.renotify ?? false,
    requireInteraction: payload.requireInteraction ?? false,
    url: payload.url,
    appointment_id: payload.appointment_id,
    homework_id: payload.homework_id,
    ...payload.data,
  });

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  const sendPromises = subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(toWebPushSubscription(sub), notificationPayload);
      sent++;
    } catch (error: unknown) {
      failed++;
      const err = error as { statusCode?: number; message?: string };
      
      if (err.statusCode === 410 || err.statusCode === 404) {
        await deactivateSubscription(sub.endpoint);
        errors.push(`Subscription expired (${err.statusCode}): ${sub.endpoint}`);
      } else {
        errors.push(`Push failed: ${err.message || "Unknown error"}`);
      }
    }
  });

  await Promise.allSettled(sendPromises);

  return { sent, failed, errors };
}

async function deactivateSubscription(endpoint: string): Promise<void> {
  const admin = createServiceClient();
  
  await admin
    .from("push_subscriptions")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("endpoint", endpoint);
}

export async function sendPushToMultipleUsers(
  userIds: string[],
  payload: PushPayload
): Promise<{ totalSent: number; totalFailed: number; userResults: Record<string, { sent: number; failed: number; errors: string[] }> }> {
  initWebPush();

  let totalSent = 0;
  let totalFailed = 0;
  const userResults: Record<string, { sent: number; failed: number; errors: string[] }> = {};

  const sendPromises = userIds.map(async (userId) => {
    const result = await sendPushToUser(userId, payload);
    userResults[userId] = result;
    totalSent += result.sent;
    totalFailed += result.failed;
  });

  await Promise.allSettled(sendPromises);

  return { totalSent, totalFailed, userResults };
}

export async function testPushNotification(userId: string): Promise<{ sent: number; failed: number; errors: string[] }> {
  return sendPushToUser(userId, {
    title: "Test Bildirimi",
    body: "Bu bir test bildirimidir. Push bildirimleri çalışıyor!",
    type: "test",
    tag: "odr-test",
    requireInteraction: true,
  });
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
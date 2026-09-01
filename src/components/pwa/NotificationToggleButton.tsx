"use client";

import { usePushNotifications, getStatusLabel, getStatusColor } from "@/components/pwa/PushNotificationManager";
import { Badge } from "@/components/ui";

export function NotificationToggleButton({ 
  className = "",
  showLabel = true,
  compact = false 
}: { 
  className?: string; 
  showLabel?: boolean;
  compact?: boolean;
}) {
  const { 
    status, 
    isSubscribed, 
    loading, 
    error, 
    toggleSubscription, 
    isSupported 
  } = usePushNotifications();

  if (!isSupported) {
    return null;
  }

  const handleClick = async () => {
    if (loading) return;
    await toggleSubscription();
  };

  const isPending = status === "pending";
  const isDenied = status === "denied";
  const label = showLabel ? getStatusLabel(status) : "";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading || isPending}
        className={`
          flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-colors duration-200
          ${isSubscribed 
            ? "bg-yellow-500/10 text-yellow-600 border border-yellow-500/30 hover:bg-yellow-500/20" 
            : isDenied 
              ? "bg-red-500/10 text-red-600 border border-red-500/30 hover:bg-red-500/20" 
              : "bg-surface border border-border text-foreground hover:bg-surface/50"
          }
          ${compact ? "px-2 py-1.5" : ""}
          ${loading ? "opacity-50 cursor-wait" : ""}
        `}
        aria-label={isSubscribed ? "Bildirimleri kapat" : "Bildirimleri aç"}
        aria-pressed={isSubscribed}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          {isSubscribed && (
            <>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </>
          )}
        </svg>
        {showLabel && <span className="hidden sm:inline">{label}</span>}
      </button>

      {error && (
        <Badge tone={getStatusColor(status) as "gold" | "neutral" | "red"} className="text-xs">
          {error}
        </Badge>
      )}

      {status === "denied" && showLabel && (
        <span className="text-xs text-muted-foreground hidden sm:inline">
          (Tarayıcı ayarlarından izin verin)
        </span>
      )}
    </div>
  );
}

export function NotificationStatusBadge({ 
  className = "" 
}: { 
  className?: string; 
}) {
  const { status, isSubscribed, isSupported } = usePushNotifications();

  if (!isSupported) {
    return null;
  }

  return (
    <Badge 
      tone={getStatusColor(status) as "gold" | "neutral" | "red"} 
      className={`text-xs ${className}`}
    >
      {getStatusLabel(status)}
    </Badge>
  );
}
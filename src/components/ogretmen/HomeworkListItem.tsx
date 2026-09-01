import { Badge } from "@/components/ui";
import { HomeworkRow } from "@/app/panel/ogretmen/dev-takibi/page";
import React from "react";

interface HomeworkListItemProps {
  hw: HomeworkRow;
  studentName: string;
  formattedDue: string;
  onEdit: (hw: HomeworkRow) => void;
}

function getStatusStyle(status: HomeworkRow["status"]): string {
  switch (status) {
    case "completed":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "overdue":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  }
}

function getStatusText(status: HomeworkRow["status"]): string {
  switch (status) {
    case "completed":
      return "Tamamlandı";
    case "overdue":
      return "Süresi Geçti";
    default:
      return "Bekliyor";
  }
}

export function HomeworkListItem({ hw, studentName, formattedDue, onEdit }: HomeworkListItemProps) {
  return React.createElement(
    "li",
    { key: hw.id, className: "py-5" },
    React.createElement(
      "div",
      { className: "flex flex-col gap-4" },
      React.createElement(
        "div",
        { className: "flex-1 min-w-0" },
        React.createElement(
          "div",
          { className: "flex flex-wrap items-center gap-2 mb-2" },
          React.createElement(Badge, { tone: "gold", className: "text-xs", children: "Ödev" }),
          React.createElement(
            "span",
            {
              className: `shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium border ${getStatusStyle(hw.status)}`,
            },
            getStatusText(hw.status)
          )
        ),
        React.createElement(
          "h3",
          { className: "text-lg sm:text-xl font-bold text-foreground" },
          hw.description || hw.title
        ),
        hw.title &&
          hw.description &&
          hw.title.trim() !== hw.description.trim() &&
          React.createElement(
            "p",
            { className: "mt-2 text-sm text-muted-foreground" },
            hw.title
          )
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => onEdit(hw),
          className: "w-full sm:w-auto rounded-full border border-yellow-500/50 px-4 py-2 text-sm font-semibold text-yellow-500 transition hover:bg-yellow-500/10",
        },
        "Düzenle"
      ),
      React.createElement(
        "div",
        { className: "mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4" },
        React.createElement(
          "div",
          null,
          React.createElement("p", { className: "text-xs text-muted-foreground" }, "Öğrenci"),
          React.createElement(
            "p",
            { className: "mt-1 text-base font-semibold text-foreground truncate" },
            studentName
          )
        ),
        React.createElement(
          "div",
          null,
          React.createElement("p", { className: "text-xs text-muted-foreground" }, "Son Tarih"),
          React.createElement(
            "p",
            { className: "mt-1 text-base font-semibold text-foreground whitespace-nowrap" },
            formattedDue
          )
        ),
        React.createElement(
          "div",
          null,
          React.createElement("p", { className: "text-xs text-muted-foreground" }, "Oluşturulma"),
          React.createElement(
            "p",
            { className: "mt-1 text-base font-semibold text-foreground" },
            new Date(hw.created_at).toLocaleDateString("tr-TR")
          )
        )
      )
    )
  );
}
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  SectionTitle,
  Card,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";

type HomeworkRow = {
   id: string;
   title: string;
   description: string | null;
   due_date: string; // ISO date string
   due_time: string | null;
   status: "assigned" | "completed" | "overdue";
   created_at: string;
   student_id: string;
   student: { full_name: string | null }[] | null;
 };

type Student = {
  id: string;
  full_name: string | null;
};

type OgretmenHomeworkPageProps = {
  onBack: () => void;
};

export default function OgretmenHomeworkPage({ onBack }: OgretmenHomeworkPageProps) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [homeworks, setHomeworks] = useState<HomeworkRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  // New homework modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [description, setDescription] = useState("");
  // Date/time state moved to selectors
const [submitLoading, setSubmitLoading] = useState(false);
   const [submitSuccess, setSubmitSuccess] = useState(false);
   const [submitError, setSubmitError] = useState<string | null>(null);
   // Edit modal state
   const [editingHomework, setEditingHomework] = useState<HomeworkRow | null>(null);
   const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Fetch homeworks (list)
  useEffect(() => {
    if (loading || !user) return;
    const currentUser = user;

    const fetchHomeworks = async () => {
      setState("loading");
      setError(null);
      try {
const { data, error: err } = await supabase
           .from("homework")
           .select(`
             id,
             title,
             description,
             due_date,
             due_time,
             status,
             created_at,
             student_id,
             student:profiles!student_id(full_name)
           `)
           .eq("teacher_id", currentUser.id)
           .order("created_at", { ascending: false });

if (err) throw err;
         setHomeworks(data as HomeworkRow[]);
         console.log("HOMEWORK LIST ROW:", data.length > 0 ? {
           id: data[0].id,
           student_id: data[0].student_id,
           student: data[0].student,
           due_date: data[0].due_date,
           due_time: data[0].due_time,
         } : {});
         setState("ready");
      } catch (e: any) {
        setError("Ödevler yüklenirken bir hata oluştu.");
        setState("error");
      }
    };

    fetchHomeworks();
  }, [loading, user]);

// Get today's date in Istanbul timezone for validation
  const [todayIstanbul, setTodayIstanbul] = useState<{date: string; hour: number; minute: number}>({date: "", hour: 0, minute: 0});
  useEffect(() => {
    try {
      const now = new Date();
      const istanbulDate = new Date(now.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }));
      const year = istanbulDate.getFullYear();
      const month = istanbulDate.getMonth() + 1; // 1-12
      const day = istanbulDate.getDate();
      const hour = istanbulDate.getHours();
      const minute = istanbulDate.getMinutes();
      setTodayIstanbul({
        date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        hour,
        minute,
      });
    } catch (e) {
      // fallback to UTC
      const now = new Date();
      setTodayIstanbul({
        date: now.toISOString().split("T")[0],
        hour: now.getUTCHours(),
        minute: now.getUTCMinutes(),
      });
    }
  }, []);

// Date picker state
    const getIstanbulToday = () => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Istanbul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());

      const year = Number(parts.find(p => p.type === "year")?.value);
      const month = Number(parts.find(p => p.type === "month")?.value);
      const day = Number(parts.find(p => p.type === "day")?.value);

      return {
        year: Number.isInteger(year) ? year : new Date().getFullYear(),
        month: Number.isInteger(month) ? month : 1,
        day: Number.isInteger(day) ? day : 1,
      };
    };

const initialDate = getIstanbulToday();
     const [selectedYear, setSelectedYear] = useState<number>(initialDate.year);
     const [selectedMonth, setSelectedMonth] = useState<number>(initialDate.month);
     const [selectedDay, setSelectedDay] = useState<number>(initialDate.day);

     // Time picker state initialization
     function getIstanbulTime() {
       const parts = new Intl.DateTimeFormat("en-GB", {
         timeZone: "Europe/Istanbul",
         hour: "2-digit",
         minute: "2-digit",
         hourCycle: "h23",
       }).formatToParts(new Date());

       const hour = Number(parts.find((p) => p.type === "hour")?.value);
       const minute = Number(parts.find((p) => p.type === "minute")?.value);

       return {
         hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0,
         minute:
           Number.isInteger(minute) && minute >= 0 && minute <= 59
             ? Math.floor(minute / 5) * 5
             : 0,
       };
     }

     const initialTime = getIstanbulTime();
     const [selectedHour, setSelectedHour] = useState<number>(initialTime.hour);
     const [selectedMinute, setSelectedMinute] = useState<number>(initialTime.minute);

console.log("DATE STATE RENDER:", {
       selectedYear,
       selectedMonth,
       selectedDay,
       yearIsNaN: Number.isNaN(selectedYear),
       monthIsNaN: Number.isNaN(selectedMonth),
       dayIsNaN: Number.isNaN(selectedDay),
     });
console.log("TIME STATE RENDER:", {
        selectedHour,
        selectedMinute,
        hourIsNaN: Number.isNaN(selectedHour),
        minuteIsNaN: Number.isNaN(selectedMinute),
      });
      const minuteOptions = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

   // Compute days in month for selected year/month with safety
   const daysInMonth = (year: number, month: number): number => {
     return new Date(year, month, 0).getDate(); // month is 1-12
   };
   const rawMaxDay = daysInMonth(selectedYear, selectedMonth);
   const maxDay =
     Number.isInteger(rawMaxDay) && rawMaxDay > 0 && rawMaxDay <= 31
       ? rawMaxDay
       : 31;

   // Adjust day if out of range
   useEffect(() => {
     if (selectedDay > maxDay) {
       setSelectedDay(maxDay);
     }
   }, [selectedYear, selectedMonth, maxDay]);

// Validate and format due_date as YYYY-MM-DD
   let formattedDueDate = null;
   const yearNum = Number(selectedYear);
   const monthNum = Number(selectedMonth);
   const dayNum = Number(selectedDay);
if (
      Number.isInteger(yearNum) &&
      Number.isInteger(monthNum) &&
      Number.isInteger(dayNum) &&
      yearNum >= 2020 &&
      monthNum >= 1 &&
      monthNum <= 12 &&
      dayNum >= 1 &&
      dayNum <= 31
    ) {
     // Check if day is valid for month/year (e.g., not 31 Feb)
     const dateCheck = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
     const valid =
       dateCheck.getUTCFullYear() === yearNum &&
       dateCheck.getUTCMonth() === monthNum - 1 &&
       dateCheck.getUTCDate() === dayNum;
     if (valid) {
       formattedDueDate =
         `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
}
    }

// Validate and format due_time for UI (HH:mm)
    let formattedDueTimeUI = null;
    const hourNumUI = Number(selectedHour);
    const minuteNumUI = Number(selectedMinute);
    const timePartsValidUI =
      Number.isInteger(hourNumUI) &&
      Number.isInteger(minuteNumUI) &&
      hourNumUI >= 0 &&
      hourNumUI <= 23 &&
      minuteNumUI >= 0 &&
      minuteNumUI <= 59;
    if (timePartsValidUI) {
      formattedDueTimeUI =
        `${String(hourNumUI).padStart(2, "0")}:${String(minuteNumUI).padStart(2, "0")}`;
    }
    // Validation: if date is today, time must be >= now (UI)
    const isTodayUI = formattedDueDate === todayIstanbul.date;
    const timeIsValidUI =
      !isTodayUI ||
      hourNumUI > todayIstanbul.hour ||
      (hourNumUI === todayIstanbul.hour && minuteNumUI >= todayIstanbul.minute);

// Time picker state


  // Fetch students for the teacher
useEffect(() => {
     if (loading || !user) return;
     const currentUser = user;

     const fetchStudents = async () => {
       try {
         const { data, error } = await supabase
           .from("teacher_students")
           .select(`
             student_id,
             student:profiles!student_id(
               full_name
             )
           `)
           .eq("teacher_id", currentUser.id);

         if (error) {
           console.error("TEACHER STUDENTS ERROR RAW:", error);
           console.error("TEACHER STUDENTS ERROR JSON:", JSON.stringify(error, null, 2));
           console.error("TEACHER STUDENTS ERROR FIELDS:", {
             message: error.message,
             code: error.code,
             details: error.details,
             hint: error.hint,
           });
           throw error;
         }

         console.log("TEACHER STUDENTS DATA:", data);

         const mapped: Student[] = (data ?? []).map((row: any) => {
           const relation = row.student;
           const fullName = Array.isArray(relation)
             ? relation[0]?.full_name ?? null
             : relation?.full_name ?? null;
           return {
             id: row.student_id,
             full_name: fullName,
           };
         });
         setStudents(mapped);
       } catch (e: any) {
         console.error("Failed to fetch students:", e);
       }
     };

     fetchStudents();
   }, [loading, user]);

  // Filtered students based on search
  const filteredStudents = students.filter((s) =>
    s.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

// Handle open modal
     const handleOpenModal = (hwToEdit?: HomeworkRow) => {
       // Reset form
       setSelectedStudentIds([]);
       setSearchQuery("");
       setDescription("");
       // Reset date/time to today Istanbul
       const today = getIstanbulToday();
       setSelectedYear(today.year);
       setSelectedMonth(today.month);
       setSelectedDay(today.day);
       const time = getIstanbulTime();
       setSelectedHour(time.hour);
       setSelectedMinute(time.minute);
       setSubmitSuccess(false);
       setSubmitError(null);
       setModalOpen(true);
       setIsEditModalOpen(false);
       setEditingHomework(null);

if (hwToEdit) {
          // fill with existing data
          setEditingHomework(hwToEdit);
          setIsEditModalOpen(true);
          setDescription(hwToEdit.description ?? "");
          if (hwToEdit.due_date) {
            const [y, m, d] = hwToEdit.due_date.split("-").map(Number);
            setSelectedYear(y);
            setSelectedMonth(m);
            setSelectedDay(d);
          }
          if (hwToEdit.due_time) {
            const [hour, minute] = hwToEdit.due_time.split(":").map(Number);
            setSelectedHour(hour);
            setSelectedMinute(minute);
          }
          // student selection – single‑student edit for now
          if (hwToEdit.student_id) {
            setSelectedStudentIds([hwToEdit.student_id]);
          }
        }
     };

  // Handle close modal
  const handleCloseModal = () => {
    setModalOpen(false);
  };

  // Handle student select toggle
  const toggleStudent = (id: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((sid) => sid !== id) : [...prev, id]
    );
  };

  // Handle description change
  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(e.target.value);
  };

// Validate form
   // Form validity is now handled inside handleSubmit

// Handle submit
    const handleSubmit = async () => {
      if (!user) return;
      // Validate students
      if (selectedStudentIds.length === 0) {
        setSubmitError("En az bir öğrenci seçin.");
        return;
      }
      // Validate description
      if (description.trim().length === 0) {
        setSubmitError("Ödev metnini yazın.");
        return;
      }
      // Validate date
      const yearNum = Number(selectedYear);
      const monthNum = Number(selectedMonth);
      const dayNum = Number(selectedDay);
      let formattedDueDate = null;
      const datePartsValid =
        Number.isInteger(yearNum) &&
        Number.isInteger(monthNum) &&
        Number.isInteger(dayNum) &&
        yearNum >= 2020 &&
        monthNum >= 1 &&
        monthNum <= 12 &&
        dayNum >= 1 &&
        dayNum <= 31;
      const calendarDateValid = datePartsValid ? (() => {
        const check = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
        return check.getUTCFullYear() === yearNum &&
               check.getUTCMonth() === monthNum - 1 &&
               check.getUTCDate() === dayNum;
      })() : false;
      if (datePartsValid && calendarDateValid) {
        formattedDueDate =
          `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      }
      console.log("HOMEWORK DATE DEBUG:", {
        selectedYear,
        selectedMonth,
        selectedDay,
        types: {
          year: typeof selectedYear,
          month: typeof selectedMonth,
          day: typeof selectedDay,
        },
        yearNum,
        monthNum,
        dayNum,
        datePartsValid,
        calendarDateValid,
        formattedDueDate,
      });
      if (!formattedDueDate) {
        setSubmitError("Geçerli bir teslim tarihi seçin.");
        return;
      }
// Validate time
       const hourNum = Number(selectedHour);
       const minuteNum = Number(selectedMinute);
       console.log("TIME BEFORE VALIDATION:", {
         selectedHour,
         selectedMinute,
         types: {
           hour: typeof selectedHour,
           minute: typeof selectedMinute,
         },
         hourNum,
         minuteNum,
         timePartsValid: Number.isInteger(hourNum) && Number.isInteger(minuteNum) && hourNum >= 0 && hourNum <= 23 && minuteNum >= 0 && minuteNum <= 59
       });
       let formattedDueTime = null;
       if (
         Number.isInteger(hourNum) &&
         Number.isInteger(minuteNum) &&
         hourNum >= 0 &&
         hourNum <= 23 &&
         minuteNum >= 0 &&
         minuteNum <= 59
       ) {
         formattedDueTime =
           `${String(hourNum).padStart(2, "0")}:${String(minuteNum).padStart(2, "0")}`;
       }
       console.log("TIME VALIDATION PASSED:", formattedDueTime);
       if (!formattedDueTime) {
         setSubmitError("Geçerli bir teslim saati seçin.");
         return;
       }
      // Validate not in past
      const now = new Date();
      const istanbulNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
      const todayDate = istanbulNow.toISOString().split("T")[0];
      const todayHour = istanbulNow.getHours();
      const todayMinute = istanbulNow.getMinutes();
      const selectedDate = formattedDueDate;
      const selectedHourNum = hourNum;
      const selectedMinuteNum = minuteNum;
      if (selectedDate === todayDate) {
        if (
          selectedHourNum < todayHour ||
          (selectedHourNum === todayHour && selectedMinuteNum < todayMinute)
        ) {
          setSubmitError("Teslim tarihi ve saati geçmişte olamaz.");
          return;
        }
      }
      // If all valid, proceed
      setSubmitLoading(true);
      setSubmitSuccess(false);
      setSubmitError(null);
      const teacherId = user!.id;
       console.log("HOMEWORK FINAL DATE:", { selectedYear, selectedMonth, selectedDay, yearNum, monthNum, dayNum, formattedDueDate });
       console.log("HOMEWORK FINAL TIME:", { selectedHour, selectedMinute, hourNum, minuteNum, formattedDueTime });

try {
       if (editingHomework) {
         // UPDATE existing homework (single student edit)
         const { error: err } = await supabase
           .from("homework")
           .update({
             description: description.trim(),
             title: description.trim().length > 0 ? description.trim().substring(0, 50) : "Ödev",
             due_date: formattedDueDate,
             due_time: `${formattedDueTime}:00`,
             student_id: selectedStudentIds[0] ?? editingHomework.student_id,
           })
           .eq("id", editingHomework.id)
           .eq("teacher_id", teacherId);

         if (err) throw err;
         console.log("HOMEWORK UPDATE SUCCESS:", editingHomework.id);
       } else {
         // INSERT new homework (multi‑student)
         const inserts = selectedStudentIds.map((studentId) => ({
           teacher_id: teacherId,
           student_id: studentId,
           title: description.trim().length > 0 ? description.trim().substring(0, 50) : "Ödev",
           description: description.trim(),
           due_date: formattedDueDate,
           due_time: `${formattedDueTime}:00`,
           status: "assigned",
         }));

         console.log("HOMEWORK INSERT PAYLOAD:", inserts);
         const { data, error: err } = await supabase
           .from("homework")
           .insert(inserts)
           .select();

         if (err) throw err;
       }

       setSubmitSuccess(true);
       // Close modal after short delay
       setTimeout(() => {
         handleCloseModal();
       }, 1500);
       // Reset edit state
       setEditingHomework(null);
       setIsEditModalOpen(false);
       // Refresh homeworks list
       await refetchHomeworks();
    } catch (e: any) {
        console.error("HOMEWORK SAVE ERROR:", e);
        // Optionally extract details
        const message = e?.error?.message ?? e?.message ?? "Unknown error";
        const details = e?.error?.details ?? e?.details ?? "";
        const hint = e?.error?.hint ?? e?.hint ?? "";
        const code = e?.error?.code ?? e?.code ?? "";
        console.error("HOMEWORK SAVE ERROR DETAILS:", { message, code, details, hint });
        setSubmitError("Ödev kaydedilirken bir hata oluştu.");
    } finally {
        setSubmitLoading(false);
    }
  };

  // Refetch homeworks after submit (call fetchHomeworks again)
  const refetchHomeworks = async () => {
    if (!user) return;
    const currentUser = user;
    setState("loading");
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("homework")
        .select(`
          id,
          title,
          description,
          due_date,
          status,
          created_at,
          student:profiles!student_id(full_name)
        `)
        .eq("teacher_id", currentUser.id)
        .order("created_at", { ascending: false });

      if (err) throw err;
      setHomeworks(data as HomeworkRow[]);
      setState("ready");
    } catch (e: any) {
      setError("Ödevler yüklenirken bir hata oluştu.");
      setState("error");
    }
  };

  if (loading || (user && !state)) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <p className="text-sm text-muted">Yükleniyor...</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="flex min-h-dvh flex-col items-center px-6 py-16 sm:px-10">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex w-full items-center justify-between">
<SecondaryButton
             onClick={onBack}
             className="w-full sm:w-auto"
           >
             Ana Menüye Dön
           </SecondaryButton>
          <div className="text-center flex-1">
            <h1 className="text-2xl font-bold text-ink-text">Ödevlendirme</h1>
            <p className="mt-2 text-sm text-muted">
              Öğrencilerine ödev ver, takip et ve tamamlanma durumlarını görüntüle.
            </p>
          </div>
<PrimaryButton
               onClick={() => handleOpenModal()}
               className="w-full sm:w-auto"
             >
               Yeni Ödev Ver
             </PrimaryButton>
        </div>

        {state === "error" && (
          <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
            {error}
          </p>
        )}

        <Card className="mt-6" padding="roomy" raised>
          {state === "loading" ? (
            <p className="text-sm text-muted">Ödevler yükleniyor...</p>
          ) : state === "error" ? (
            <p className="text-sm text-red-300">Ödevler yüklenemedi.</p>
          ) : homeworks.length === 0 ? (
            <p className="text-sm leading-relaxed text-muted">
              Henüz ödev vermediniz.
            </p>
          ) : (
<ul className="divide-y divide-line">
               {homeworks.map((hw) => {
                 const studentRaw = hw.student as { full_name: string | null }[] | { full_name: string | null } | null;
                 let studentName: string | null = null;
                 if (Array.isArray(studentRaw)) {
                   studentName = studentRaw[0]?.full_name ?? null;
                 } else if (studentRaw) {
                   studentName = studentRaw.full_name;
                 }
                 if (studentName === null) studentName = "Öğrenci bilgisi yok";
                 const formattedDue = formatHomeworkDue(hw.due_date, hw.due_time);
                 return (
<li key={hw.id} className="flex flex-col gap-4 py-4 p-4 sm:p-5">
                      {/* ÜST BÖLÜM */}
<div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <p className="mb-1 text-xs font-medium text-muted">
                              Ödev
                            </p>
                            <h3 className="text-lg font-bold text-ink-text">
                              {hw.description || hw.title}
                            </h3>
                            {hw.title &&
                              hw.description &&
                              hw.title.trim() !== hw.description.trim() && (
                                <p className="mt-2 text-sm text-muted">
                                  {hw.title}
                                </p>
                              )}
                          </div>
                         <div className="flex shrink-0 items-center gap-2">
                           <span className="shrink-0 rounded-full border border-current/40 px-3 py-1 text-xs font-semibold">
                           {hw.status === "assigned" ? "Bekliyor" : hw.status === "completed" ? "Tamamlandı" : "Süresi Geçti"}
                         </span>
                           <button
                             type="button"
                             onClick={() => {
                               console.log("EDIT BUTTON CLICKED:", hw.id);
                               handleOpenModal(hw);
                             }}
                             className="rounded-full border border-gold/50 px-3 py-1 text-xs font-semibold text-gold transition hover:bg-gold/10"
                           >
                             Düzenle
                           </button>
                         </div>
                       </div>
                      {/* ALT BİLGİLERİ */}
                      <div className="mt-5 grid gap-4 border-t border-surface/20 pt-4 sm:grid-cols-3 sm:gap-6">
                        <div>
                          <p className="text-xs text-muted">Öğrenci</p>
                          <p className="mt-1 text-base font-semibold text-ink-text">{studentName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted">Son Tarih</p>
                          <p className="mt-1 text-base font-semibold text-ink-text">{formattedDue}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted">Oluşturulma</p>
                          <p className="mt-1 text-base font-semibold text-ink-text">{new Date(hw.created_at).toLocaleDateString("tr-TR")}</p>
                        </div>
                      </div>
                    </li>
                 );
               })}
             </ul>
          )}
        </Card>

        {/* New Homework Modal */}
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center ${
            modalOpen ? "block" : "hidden"
          }`}
          aria-hidden={!modalOpen ? "true" : "false"}
          role="dialog"
          aria-modal="true"
        >
          {/* Backdrop */}
          <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm" onClick={handleCloseModal} />
          {/* Modal Content */}
          <div className="relative bg-surface rounded-xl p-6 w-full max-w-2xl mx-4 shadow-lg">
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold text-ink-text">
       {editingHomework ? "Ödevi Düzenle" : "Yeni Ödev Ver"}
     </h2>
              <button
                onClick={handleCloseModal}
                className="text-muted hover:text-gold transition-colors"
                aria-label="Kapat"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4">
              {/* Students Selection */}
              <div>
                <label className="block text-sm font-medium text-ink-text mb-1">
                  Öğrencileri Seç
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Öğrenci ara..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-surface/50 border border-surface/20 rounded-md text-sm text-ink-text focus:border-gold focus:ring-gold/20"
                  />
                  <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-2.5 h-4 w-4 text-muted" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                  </svg>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {selectedStudentIds.length} öğrenci seçildi
                </p>
                {/* Selected chips */}
                {selectedStudentIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedStudentIds.map((sid) => {
                      const student = students.find((s) => s.id === sid);
                      return (
                        <span
                          key={sid}
                          className="flex items-center bg-gold/20 text-gold text-xs px-2 py-1 rounded-full"
                        >
                          {student?.full_name ?? sid}
                        </span>
                      );
                    })}
                  </div>
                )}
                {/* Students list */}
                <div className="mt-2 max-h-[200px] overflow-y-auto border border-surface/20 rounded-md">
                  {filteredStudents.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted">Öğrenci bulunamadı.</p>
                  ) : (
                    <ul className="divide-y divide-surface/20">
                      {filteredStudents.map((student) => (
                        <li key={student.id} className="flex items-center px-3 py-2 cursor-pointer hover:bg-gold/5 transition-colors">
                          <input
                            type="checkbox"
                            checked={selectedStudentIds.includes(student.id)}
                            onChange={() => toggleStudent(student.id)}
                            className="h-4 w-4 text-gold"
                          />
                          <span className="ml-3 text-sm text-ink-text flex-1">
                            {student.full_name ?? "İsim bulunamadı"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-ink-text mb-1">
                  Ödev
                </label>
                <textarea
                  value={description}
                  onChange={handleDescriptionChange}
                  placeholder="Öğrenciye vereceğiniz ödevi buraya yazın..."
                  className="w-full min-h-[100px] p-3 bg-surface/50 border border-surface/20 rounded-md text-sm text-ink-text focus:border-gold focus:ring-gold/20 resize-none"
                  required
                />
              </div>

{/* Due Date */}
                <div>
                  <label className="block text-sm font-medium text-ink-text mb-1">
                    Son Teslim Tarihi
                  </label>
                  <div className="flex gap-3">
                    <select
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(Number(e.target.value))}
                      className="w-[80px] p-2 bg-surface/50 border border-surface/20 rounded-md text-sm text-ink-text focus:border-gold focus:ring-gold/20"
                    >
                      {[...Array(11).keys()].map((i) => new Date().getFullYear() + i).map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                    <select
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(Number(e.target.value))}
                      className="w-[90px] p-2 bg-surface/50 border border-surface/20 rounded-md text-sm text-ink-text focus:border-gold focus:ring-gold/20"
                    >
                      {["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"].map((m, idx) => (
                        <option key={idx + 1} value={idx + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
<select
                       value={selectedDay}
                       onChange={(e) => setSelectedDay(Number(e.target.value))}
                       className="w-[70px] p-2 bg-surface/50 border border-surface/20 rounded-md text-sm text-ink-text focus:border-gold focus:ring-gold/20"
                     >
                       {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                         <option key={d} value={d}>
                           {String(d).padStart(2, "0")}
                         </option>
                       ))}
                     </select>
                  </div>
{!timeIsValidUI && (
  <p className="mt-1 text-sm text-red-300">
    Seçilen saat şu anda geçmiş olamaz.
  </p>
)}
                </div>

                {/* Due Time */}
                <div>
                  <label className="block text-sm font-medium text-ink-text mb-1">
                    Son Teslim Saati
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={selectedHour}
                      onChange={(e) => setSelectedHour(Number(e.target.value))}
                      className="w-[70px] p-2 bg-surface/50 border border-surface/20 rounded-md text-sm text-ink-text focus:border-gold focus:ring-gold/20"
                    >
                      {[...Array(24).keys()].map((h) => (
                        <option key={h} value={h}>
                          {String(h).padStart(2, "0")}
                        </option>
                      ))}
                    </select>
                    <span className="text-ink-text mx-1">:</span>
                    <select
                      value={selectedMinute}
                      onChange={(e) => setSelectedMinute(Number(e.target.value))}
                      className="w-[70px] p-2 bg-surface/50 border border-surface/20 rounded-md text-sm text-ink-text focus:border-gold focus:ring-gold/20"
                    >
                      {minuteOptions.map((m) => (
                        <option key={m} value={m}>
                          {String(m).padStart(2, "0")}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

{/* Submit Button */}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submitLoading}
                    onClick={() => console.log("HOMEWORK SUBMIT BUTTON CLICKED")}
                    className={`flex items-center px-4 py-2 bg-gold/20 text-gold font-medium rounded-md hover:bg-gold/30 transition-colors ${
                      submitLoading ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                  >
                    {submitLoading ? "Gönderiliyor..." : (editingHomework ? "Değişiklikleri Kaydet" : "Ödevi Gönder")}
                  </button>
                </div>

              {/* Status messages */}
              {submitError && (
                <p className="mt-3 text-sm text-red-300">
                  {submitError}
                </p>
              )}
              {submitSuccess && (
                <p className="mt-3 text-sm text-gold">
                  Ödev başarıyla gönderildi.
                </p>
              )}
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

function formatHomeworkDue(date: string | null, time: string | null): string {
  if (!date) return "-";
  const [year, month, day] = date.split("-");
  const formattedDate = `${day}.${month}.${year}`;
  if (!time) return formattedDate;
  const formattedTime = time.slice(0, 5); // HH:MM
  return `${formattedDate} ${formattedTime}`;
}

// Helper Badge component (reuse from ui if exists, else simple)
function Badge({
  tone,
  className,
  children,
}: {
  tone: "gold" | "neutral";
  className?: string;
  children: React.ReactNode;
}) {
  const bg =
    tone === "gold"
      ? "bg-gold/20 text-gold"
      : "bg-neutral/20 text-neutral";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${bg} ${className}`}
    >
      {children}
    </span>
  );
}
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
  Badge,
} from "@/components/ui";

type HomeworkRow = {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
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
};

export default function OgretmenHomeworkPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [homeworks, setHomeworks] = useState<HomeworkRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [description, setDescription] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [editingHomework, setEditingHomework] = useState<HomeworkRow | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

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
        setState("ready");
      } catch (e: any) {
        setError("Ödevler yüklenirken bir hata oluştu.");
        setState("error");
      }
    };

    fetchHomeworks();
  }, [loading, user]);

  const [todayIstanbul, setTodayIstanbul] = useState<{date: string; hour: number; minute: number}>({date: "", hour: 0, minute: 0});
  useEffect(() => {
    try {
      const now = new Date();
      const istanbulDate = new Date(now.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }));
      const year = istanbulDate.getFullYear();
      const month = istanbulDate.getMonth() + 1;
      const day = istanbulDate.getDate();
      const hour = istanbulDate.getHours();
      const minute = istanbulDate.getMinutes();
      setTodayIstanbul({
        date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        hour,
        minute,
      });
    } catch (e) {
      const now = new Date();
      setTodayIstanbul({
        date: now.toISOString().split("T")[0],
        hour: now.getUTCHours(),
        minute: now.getUTCMinutes(),
      });
    }
  }, []);

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

  const minuteOptions = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  const daysInMonth = (year: number, month: number): number => {
    return new Date(year, month, 0).getDate();
  };
  const rawMaxDay = daysInMonth(selectedYear, selectedMonth);
  const maxDay =
    Number.isInteger(rawMaxDay) && rawMaxDay > 0 && rawMaxDay <= 31
      ? rawMaxDay
      : 31;

  useEffect(() => {
    if (selectedDay > maxDay) {
      setSelectedDay(maxDay);
    }
  }, [selectedYear, selectedMonth, maxDay]);

  let formattedDueDate: string | null = null;
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

  let formattedDueTimeUI: string | null = null;
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
  const isTodayUI = formattedDueDate === todayIstanbul.date;
  const timeIsValidUI =
    !isTodayUI ||
    hourNumUI > todayIstanbul.hour ||
    (hourNumUI === todayIstanbul.hour && minuteNumUI >= todayIstanbul.minute);

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
          console.error("TEACHER STUDENTS ERROR:", error);
          throw error;
        }

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

  const filteredStudents = students.filter((s) =>
    s.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleOpenModal = (hwToEdit?: HomeworkRow) => {
    setSelectedStudentIds([]);
    setSearchQuery("");
    setDescription("");
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
      if (hwToEdit.student_id) {
        setSelectedStudentIds([hwToEdit.student_id]);
      }
    }
  };

  const handleCloseModal = () => {
    setModalOpen(false);
  };

  const toggleStudent = (id: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((sid) => sid !== id) : [...prev, id]
    );
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(e.target.value);
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (selectedStudentIds.length === 0) {
      setSubmitError("En az bir öğrenci seçin.");
      return;
    }
    if (description.trim().length === 0) {
      setSubmitError("Ödev metnini yazın.");
      return;
    }

    const yearNum = Number(selectedYear);
    const monthNum = Number(selectedMonth);
    const dayNum = Number(selectedDay);
    let formattedDueDate: string | null = null;
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
    if (!formattedDueDate) {
      setSubmitError("Geçerli bir teslim tarihi seçin.");
      return;
    }

    const hourNum = Number(selectedHour);
    const minuteNum = Number(selectedMinute);
    let formattedDueTime: string | null = null;
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
    if (!formattedDueTime) {
      setSubmitError("Geçerli bir teslim saati seçin.");
      return;
    }

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

    setSubmitLoading(true);
    setSubmitSuccess(false);
    setSubmitError(null);
    const teacherId = user!.id;

    try {
      if (editingHomework) {
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
      } else {
        const inserts = selectedStudentIds.map((studentId) => ({
          teacher_id: teacherId,
          student_id: studentId,
          title: description.trim().length > 0 ? description.trim().substring(0, 50) : "Ödev",
          description: description.trim(),
          due_date: formattedDueDate,
          due_time: `${formattedDueTime}:00`,
          status: "assigned",
        }));

        const { error: err } = await supabase
          .from("homework")
          .insert(inserts)
          .select();

        if (err) throw err;
      }

      setSubmitSuccess(true);
      setTimeout(() => {
        handleCloseModal();
      }, 1500);
      setEditingHomework(null);
      setIsEditModalOpen(false);
      await refetchHomeworks();
    } catch (e: any) {
      console.error("HOMEWORK SAVE ERROR:", e);
      setSubmitError("Ödev kaydedilirken bir hata oluştu.");
    } finally {
      setSubmitLoading(false);
    }
  };

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
          due_time,
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
    <main className="flex min-h-dvh flex-col px-6 py-8 sm:px-10">
      <div className="w-full max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <SecondaryButton onClick={() => router.push("/panel/ogretmen")} className="w-full sm:w-auto">
            Ana Menüye Dön
          </SecondaryButton>
          <div className="flex-1 text-center">
            <h1 className="text-3xl md:text-4xl font-bold text-foreground">Ödevlendirme</h1>
            <p className="mt-2 text-muted-foreground">
              Öğrencilerine ödev ver, takip et ve tamamlanma durumlarını görüntüle.
            </p>
          </div>
          <PrimaryButton onClick={() => handleOpenModal()} className="w-full sm:w-auto">
            Yeni Ödev Ver
          </PrimaryButton>
        </div>

        {state === "error" && (
          <Card className="overflow-hidden border-red-500/30 bg-red-500/10" padding="snug">
            <p role="alert" className="text-sm text-red-400">{error}</p>
          </Card>
        )}

        <Card className="overflow-hidden" padding="snug">
          {state === "loading" ? (
            <p className="text-sm text-muted-foreground text-center py-8">Ödevler yükleniyor...</p>
          ) : state === "error" ? (
            <p className="text-sm text-red-400 text-center py-8">Ödevler yüklenemedi.</p>
          ) : homeworks.length === 0 ? (
            <p className="text-sm leading-relaxed text-muted-foreground text-center py-8">
              Henüz ödev vermediniz.
            </p>
          ) : (
            <ul className="divide-y divide-border">
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
                  <li key={hw.id} className="py-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge tone="gold" className="text-xs">Ödev</Badge>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                              hw.status === "completed"
                                ? "bg-green-500/20 text-green-400 border-green-500/30"
                                : hw.status === "overdue"
                                ? "bg-red-500/20 text-red-400 border-red-500/30"
                                : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                            }`}
                          >
                            {hw.status === "assigned" ? "Bekliyor" : hw.status === "completed" ? "Tamamlandı" : "Süresi Geçti"}
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-foreground">{hw.description || hw.title}</h3>
                        {hw.title && hw.description && hw.title.trim() !== hw.description.trim() && (
                          <p className="mt-2 text-sm text-muted-foreground">{hw.title}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenModal(hw)}
                          className="rounded-full border border-yellow-500/50 px-3 py-1.5 text-xs font-semibold text-yellow-500 transition hover:bg-yellow-500/10"
                        >
                          Düzenle
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-3 sm:gap-6">
                      <div>
                        <p className="text-xs text-muted-foreground">Öğrenci</p>
                        <p className="mt-1 text-base font-semibold text-foreground">{studentName}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Son Tarih</p>
                        <p className="mt-1 text-base font-semibold text-foreground">{formattedDue}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Oluşturulma</p>
                        <p className="mt-1 text-base font-semibold text-foreground">{new Date(hw.created_at).toLocaleDateString("tr-TR")}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {modalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6 sm:items-center sm:py-10"
            onClick={(e) => {
              if (e.target === e.currentTarget) handleCloseModal();
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-lg">
              <div className="flex justify-between items-start mb-4 border-b border-border px-6 py-4">
                <h2 className="text-xl font-bold text-foreground">
                  {editingHomework ? "Ödevi Düzenle" : "Yeni Ödev Ver"}
                </h2>
                <button
                  onClick={handleCloseModal}
                  className="text-muted-foreground hover:text-yellow-500 transition-colors"
                  aria-label="Kapat"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4 p-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Öğrencileri Seç</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Öğrenci ara..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11"
                    />
                    <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedStudentIds.length} öğrenci seçildi</p>
                  {selectedStudentIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {selectedStudentIds.map((sid) => {
                        const student = students.find((s) => s.id === sid);
                        return (
                          <span
                            key={sid}
                            className="flex items-center bg-yellow-500/20 text-yellow-500 text-xs px-2 py-1 rounded-full"
                          >
                            {student?.full_name ?? sid}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-2 max-h-[200px] overflow-y-auto border border-border rounded-xl">
                    {filteredStudents.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">Öğrenci bulunamadı.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {filteredStudents.map((student) => (
                          <li key={student.id} className="flex items-center px-3 py-2 cursor-pointer hover:bg-yellow-500/5 transition-colors">
                            <input
                              type="checkbox"
                              checked={selectedStudentIds.includes(student.id)}
                              onChange={() => toggleStudent(student.id)}
                              className="h-4 w-4 text-yellow-500"
                            />
                            <span className="ml-3 text-sm text-foreground flex-1">{student.full_name ?? "İsim bulunamadı"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Ödev</label>
                  <textarea
                    value={description}
                    onChange={handleDescriptionChange}
                    placeholder="Öğrenciye vereceğiniz ödevi buraya yazın..."
                    className="w-full min-h-[100px] p-3 rounded-xl border border-border bg-surface text-sm text-foreground placeholder:text-muted-foreground focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11 resize-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Son Teslim Tarihi</label>
                  <div className="flex gap-3">
                    <select
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(Number(e.target.value))}
                      className="w-[80px] rounded-xl border border-border bg-surface px-3 py-3 text-sm text-foreground focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11"
                    >
                      {[...Array(11).keys()].map((i) => new Date().getFullYear() + i).map((y) => (
                        <option key={y} value={y} style={{ backgroundColor: "#1a1a1a", color: "#ffffff" }}>{y}</option>
                      ))}
                    </select>
                    <select
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(Number(e.target.value))}
                      className="w-[90px] rounded-xl border border-border bg-surface px-3 py-3 text-sm text-foreground focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11"
                    >
                      {["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"].map((m, idx) => (
                        <option key={idx + 1} value={idx + 1} style={{ backgroundColor: "#1a1a1a", color: "#ffffff" }}>{m}</option>
                      ))}
                    </select>
                    <select
                      value={selectedDay}
                      onChange={(e) => setSelectedDay(Number(e.target.value))}
                      className="w-[70px] rounded-xl border border-border bg-surface px-3 py-3 text-sm text-foreground focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11"
                    >
                      {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d} style={{ backgroundColor: "#1a1a1a", color: "#ffffff" }}>{String(d).padStart(2, "0")}</option>
                      ))}
                    </select>
                  </div>
                  {!timeIsValidUI && (
                    <p className="mt-1 text-sm text-red-400">Seçilen saat şu anda geçmiş olamaz.</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Son Teslim Saati</label>
                  <div className="flex gap-2">
                    <select
                      value={selectedHour}
                      onChange={(e) => setSelectedHour(Number(e.target.value))}
                      className="w-[70px] rounded-xl border border-border bg-surface px-3 py-3 text-sm text-foreground focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11"
                    >
                      {[...Array(24).keys()].map((h) => (
                        <option key={h} value={h} style={{ backgroundColor: "#1a1a1a", color: "#ffffff" }}>{String(h).padStart(2, "0")}</option>
                      ))}
                    </select>
                    <span className="text-foreground mx-1">:</span>
                    <select
                      value={selectedMinute}
                      onChange={(e) => setSelectedMinute(Number(e.target.value))}
                      className="w-[70px] rounded-xl border border-border bg-surface px-3 py-3 text-sm text-foreground focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11"
                    >
                      {minuteOptions.map((m) => (
                        <option key={m} value={m} style={{ backgroundColor: "#1a1a1a", color: "#ffffff" }}>{String(m).padStart(2, "0")}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <PrimaryButton
                    type="submit"
                    disabled={submitLoading}
                    className="w-full sm:w-auto"
                  >
                    {submitLoading ? "Gönderiliyor..." : (editingHomework ? "Değişiklikleri Kaydet" : "Ödevi Gönder")}
                  </PrimaryButton>
                </div>

                {submitError && (
                  <p className="text-sm text-red-400">{submitError}</p>
                )}
                {submitSuccess && (
                  <p className="text-sm text-green-400">Ödev başarıyla gönderildi.</p>
                )}
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function formatHomeworkDue(date: string | null, time: string | null): string {
  if (!date) return "-";
  const [year, month, day] = date.split("-");
  const formattedDate = `${day}.${month}.${year}`;
  if (!time) return formattedDate;
  const formattedTime = time.slice(0, 5);
  return `${formattedDate} ${formattedTime}`;
}
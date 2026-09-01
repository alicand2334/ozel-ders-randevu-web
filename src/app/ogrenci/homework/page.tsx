'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  SectionTitle,
  Card,
  PrimaryButton,
  SecondaryButton,
  Badge,
} from '@/components/ui';
import { NotificationToggleButton } from '@/components/pwa/NotificationToggleButton';

type HomeworkRow = {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  due_time: string | null;
  status: 'assigned' | 'completed' | 'overdue';
  created_at: string;
  teacher: { full_name: string | null }[] | null;
};

type TabType = 'pending' | 'completed';

export default function OgrenciHomeworkPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [homeworks, setHomeworks] = useState<HomeworkRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('pending');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    const currentUser = user;

    const fetchHomeworks = async () => {
      setState('loading');
      setError(null);
      try {
        const { data, error: err } = await supabase
          .from('homework')
          .select(`
            id,
            title,
            description,
            due_date,
            due_time,
            status,
            created_at,
            teacher:profiles!teacher_id(full_name)
          `)
          .eq('student_id', currentUser.id)
          .order('created_at', { ascending: false });

        if (err) throw err;
        setHomeworks(data as HomeworkRow[]);
        setState('ready');
      } catch (e: any) {
        setError('Ödevler yüklenirken bir hata oluştu.');
        setState('error');
      }
    };

    fetchHomeworks();
  }, [loading, user]);

  const pendingCount = homeworks.filter((h) => h.status === 'assigned' || h.status === 'overdue').length;
  const completedCount = homeworks.filter((h) => h.status === 'completed').length;

  const filteredHomeworks = homeworks.filter((hw) => {
    if (activeTab === 'pending') {
      return hw.status === 'assigned' || hw.status === 'overdue';
    }
    return hw.status === 'completed';
  });

  const formatDate = (isoDate: string) => {
    const [year, month, day] = isoDate.split('-');
    return `${day}.${month}.${year}`;
  };

  const formatCreatedAt = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDue = (dueDate: string, dueTime: string | null) => {
    const date = formatDate(dueDate);
    if (!dueTime) return date;
    return `${date} ${dueTime.slice(0, 5)}`;
  };

  const getStatusLabel = (status: HomeworkRow['status']) => {
    switch (status) {
      case 'assigned':
        return 'Bekliyor';
      case 'completed':
        return 'Tamamlandı';
      case 'overdue':
        return 'Süresi Geçti';
      default:
        return status;
    }
  };

  const getStatusBadgeTone = (status: HomeworkRow['status']): 'gold' | 'neutral' => {
    if (status === 'completed') return 'neutral';
    return 'gold';
  };

  const handleToggleComplete = async (hw: HomeworkRow) => {
    setUpdatingId(hw.id);
    try {
      const newStatus = hw.status === 'completed' ? 'assigned' : 'completed';
      const { error: err } = await supabase
        .from('homework')
        .update({ status: newStatus })
        .eq('id', hw.id);

      if (err) throw err;

      setHomeworks((prev) =>
        prev.map((h) => (h.id === hw.id ? { ...h, status: newStatus } : h))
      );
    } catch {
      // Error handled silently, UI will not update
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/giris');
  };

  const handleGoBack = () => {
    router.push('/ogrenci');
  };

  if (loading || (user && state === 'loading')) {
    return (
      <main className='flex min-h-dvh items-center justify-center px-6'>
        <p className='text-sm text-muted'>Yükleniyor...</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className='flex min-h-dvh flex-col px-6 py-8 sm:px-10'>
      <div className='w-full max-w-4xl mx-auto space-y-6'>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex items-center gap-2'>
            <h1 className='text-3xl md:text-4xl font-bold text-foreground'>Ödev Takibi</h1>
            <NotificationToggleButton showLabel={false} compact />
          </div>
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end gap-3'>
            <SecondaryButton onClick={handleGoBack} className='w-full sm:w-auto'>
              Ana Menüye Dön
            </SecondaryButton>
            <PrimaryButton
              onClick={handleSignOut}
              className='w-full sm:w-auto bg-red-600 hover:bg-red-700 active:bg-red-800 focus-visible:ring-red-500 text-white'
            >
              Çıkış Yap
            </PrimaryButton>
          </div>
        </div>

        <div className='flex gap-2 border-b border-border'>
          <button
            onClick={() => setActiveTab('pending')}
            className={`flex-1 py-3 px-4 text-sm font-semibold transition-colors duration-200 border-b-2 border-transparent
              ${activeTab === 'pending'
                ? 'border-yellow-500 text-foreground'
                : 'text-muted-foreground hover:text-foreground'}`}
          >
            Bekleyen ({pendingCount})
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`flex-1 py-3 px-4 text-sm font-semibold transition-colors duration-200 border-b-2 border-transparent
              ${activeTab === 'completed'
                ? 'border-yellow-500 text-foreground'
                : 'text-muted-foreground hover:text-foreground'}`}
          >
            Tamamlanan ({completedCount})
          </button>
        </div>

        {state === 'error' && (
          <p className='rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300'>
            {error}
          </p>
        )}

        <Card className='overflow-hidden' padding='snug'>
          {state === 'loading' ? (
            <p className='text-sm text-muted text-center py-8'>Ödevler yükleniyor...</p>
          ) : filteredHomeworks.length === 0 ? (
            <p className='text-sm leading-relaxed text-muted text-center py-8'>
              {activeTab === 'pending'
                ? 'Bekleyen ödeviniz bulunmuyor.'
                : 'Tamamlanmış ödeviniz bulunmuyor.'}
            </p>
          ) : (
            <ul className='divide-y divide-border'>
              {filteredHomeworks.map((hw) => {
                const teacherRaw = hw.teacher as
                  | { full_name: string | null }[]
                  | { full_name: string | null }
                  | null;
                let teacherName: string | null = null;
                if (Array.isArray(teacherRaw)) {
                  teacherName = teacherRaw[0]?.full_name ?? null;
                } else if (teacherRaw) {
                  teacherName = teacherRaw.full_name;
                }
                if (teacherName === null) teacherName = 'Öğretmen bilgisi yok';

                const isPending = hw.status === 'assigned' || hw.status === 'overdue';
                const isUpdating = updatingId === hw.id;

                return (
                  <li key={hw.id} className='py-5 sm:py-6'>
                    <div className='relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
                      <div className='flex-1 min-w-0'>
                        <div className='flex items-center gap-2 mb-2'>
                          <Badge tone='gold' className='text-xs'>
                            Ödev
                          </Badge>
                          <span
                            className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium
                              ${
                                hw.status === 'completed'
                                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                  : hw.status === 'overdue'
                                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                  : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                              }`}
                          >
                            {getStatusLabel(hw.status)}
                          </span>
                        </div>
                        <h3 className='text-xl font-bold text-foreground'>{hw.title}</h3>
                        {hw.description && hw.description.trim() !== hw.title.trim() && (
                          <p className='mt-2 text-base text-muted-foreground'>{hw.description}</p>
                        )}
                        <div className='mt-4 space-y-2 text-sm'>
                          <div className='flex items-center gap-2 text-muted-foreground'>
                            <span className='font-medium text-foreground'>Öğretmen tarafından gönderilme:</span>
                            <span>{formatCreatedAt(hw.created_at)}</span>
                          </div>
                          <div className='flex items-center gap-2 text-muted-foreground'>
                            <span className='font-medium text-foreground'>Son Teslim:</span>
                            <span>{formatDue(hw.due_date, hw.due_time)}</span>
                          </div>
                          <div className='flex items-center gap-2 text-muted-foreground'>
                            <span className='font-medium text-foreground'>Durum:</span>
                            <span>{getStatusLabel(hw.status)}</span>
                          </div>
                          {teacherName && (
                            <div className='flex items-center gap-2 text-muted-foreground'>
                              <span className='font-medium text-foreground'>Öğretmen:</span>
                              <span>{teacherName}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {isPending && (
                        <button
                          onClick={() => handleToggleComplete(hw)}
                          disabled={isUpdating}
                          className={`mt-4 shrink-0 w-full sm:w-auto rounded-full px-5 py-2.5 text-sm font-semibold transition-colors duration-200
                            ${hw.status === 'completed'
                              ? 'bg-green-600 hover:bg-green-700 text-white'
                              : 'bg-yellow-500 hover:bg-yellow-600 text-ink'}`}
                        >
                          {isUpdating ? 'İşleniyor...' : hw.status === 'completed' ? 'Tamamlandı' : 'Tamamla'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
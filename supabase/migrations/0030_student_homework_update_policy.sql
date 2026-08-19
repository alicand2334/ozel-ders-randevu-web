-- |--------------------------------------------------------------------------
-- | Migration: 0030_student_homework_update_policy.sql
-- | Açıklama:
-- |   Öğrencinin sadece kendi homework kaydının status alanını
-- |   "completed" olarak güncelleyebileceği RLS politikası.
-- |   Mevcut öğretmen politikalarına dokunulmaz; yalnızca
-- |   authenticated rolü için ek bir UPDATE policy eklenir.
-- |--------------------------------------------------------------------------

-- Öğrenci UPDATE policy'si
drop policy if exists homework_student_update_policy on public.homework;
create policy homework_student_update_policy
    on public.homework
    for update
    to authenticated
    using (student_id = auth.uid())                                   -- sadece kendi ödevlerini gör
    with check (                                                     -- sadece status değiştirilebilir ve sadece completed olabilir
        student_id = auth.uid() and
        (status = 'completed')
    );

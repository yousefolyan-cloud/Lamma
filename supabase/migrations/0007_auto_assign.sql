-- Routes stay open until the first eligible driver applies: with application_window_min = 0
-- a published route is assignable at once, and this job assigns due routes every minute.
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lamma_assign_due_routes') then
    perform cron.unschedule('lamma_assign_due_routes');
  end if;
  perform cron.schedule('lamma_assign_due_routes', '* * * * *',
    $job$do $b$ begin
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
      perform public.assign_due_routes();
    end $b$;$job$);
end $$;

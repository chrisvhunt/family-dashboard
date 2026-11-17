import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { startOfWeek, startOfDay, addDays, format } from 'date-fns';
import { useHomeAssistant } from './hooks/useHomeAssistant';
import { useCalendarEvents, CalendarNotSupportedError } from './hooks/useCalendarEvents';
import { useFamily } from './hooks/useFamily';
import { useWeather } from './hooks/useWeather';
import { useChores } from './hooks/useChores';
import { Clock } from './components/Clock';
import { WeekCalendar } from './components/WeekCalendar';
import { DashboardView } from './components/DashboardView';
import { EventModal, EventFormData } from './components/EventModal';
import { FamilyFilter } from './components/FamilyFilter';
import { SettingsView } from './components/SettingsView';
import { useSettings } from './hooks/useSettings';
import { ChoresView } from './components/ChoresView';
import { Leaderboard } from './components/Leaderboard';
import { Sidebar, SidebarView } from './components/Sidebar';
import { MusicView } from './components/MusicView';
import { PhotoFrame } from './components/PhotoFrame';
import { NowPlayingBar } from './components/NowPlayingBar';
import { useMusic } from './hooks/useMusic';
import { useNotifications } from './hooks/useNotifications';
import { ScreenSaver } from './components/ScreenSaver';
import { GroceryView } from './components/GroceryView';
import { OmniAdd } from './components/OmniAdd';
import { CalendarSidebar } from './components/CalendarSidebar';
import { Timer } from './components/Timer';
import { WeatherView } from './components/WeatherView';
import { useIngressDetect } from './hooks/useIngressDetect';
import { useHaAuth } from './hooks/useHaAuth';
import { useTheme } from './hooks/useTheme';
import { useLocalCalendar } from './hooks/useLocalCalendar';
import { useDashboardTasks } from './hooks/useDashboardTasks';
import { useBridgeConfig } from './hooks/useBridgeConfig';
import { useGoogleCalendar, isGoogleCalendarId } from './hooks/useGoogleCalendar';
import { useGoogleTasks, isGoogleTaskList } from './hooks/useGoogleTasks';
import { captureSetupFromUrl, isBridgeConfigured } from './api/google-bridge';
import { NewsView } from './components/NewsView';
import { WallView } from './components/WallView';
import { GoogleSetupView } from './components/GoogleSetupView';
import OnboardingView from './components/OnboardingView';
import { FocusView } from './components/focus/FocusView';
import { getFocusMemberId, clearFocusMode, setDeviceFocusMember } from './focus';
import { CalendarEvent, resolveCalendarColor } from './types';
import { getConfig, patchConfig } from './config';
import { I18nContext, createI18n } from './i18n';

const config = getConfig();

// Lets the tablet be set up from one link: ?bridge=<web app url>&key=<key>
captureSetupFromUrl();

export function App() {
  const auth = useHaAuth();
  const { client, connected } = useHomeAssistant();
  const { isIngress, compact } = useIngressDetect();
  const {
    settings,
    updateSettings,
    resetSettings,
    exportSettings,
    importSettings,
    clearLocalStorage,
  } = useSettings();

  const i18n = useMemo(() => createI18n(settings.locale), [settings.locale]);
  const { t } = i18n;

  const {
    members,
    addMember,
    updateMember,
    removeMember,
  } = useFamily();

  const {
    calendars: haCalendars,
    events: haEvents,
    fetchCalendars,
    fetchEvents,
    createEvent: createHaEvent,
    updateEvent: updateHaEvent,
    deleteEvent: deleteHaEvent,
  } = useCalendarEvents(connected, {
    calendarColors: settings.calendarColors,
    members,
  }, client);

  const localCal = useLocalCalendar();

  // Google Calendar / Tasks / news via the Apps Script bridge (no Home Assistant needed)
  const bridgeCfg = useBridgeConfig();
  const googleEnabled = isBridgeConfigured(bridgeCfg);
  const [showHaOnboarding, setShowHaOnboarding] = useState(false);
  const gcal = useGoogleCalendar(googleEnabled, {
    calendarColors: settings.calendarColors,
    members,
  });

  // Resolve the local calendar's color the same way everywhere (user override or indigo default).
  const localCalendarColor = resolveCalendarColor(localCal.calendar.id, 0, {
    calendarColors: settings.calendarColors,
    defaultColor: localCal.calendar.color,
  });

  // Merge local + HA + Google calendars and events
  const calendars = useMemo(
    () => [{ ...localCal.calendar, color: localCalendarColor }, ...haCalendars, ...gcal.calendars],
    [localCal.calendar, localCalendarColor, haCalendars, gcal.calendars],
  );
  const events = useMemo(
    () => [
      ...localCal.events.map((ev) => ({ ...ev, color: localCalendarColor })),
      ...haEvents,
      ...gcal.events,
    ].sort((a, b) => a.start.localeCompare(b.start)),
    [localCal.events, localCalendarColor, haEvents, gcal.events],
  );

  // Route create/update/delete to local, Google or HA based on calendar ID
  const createEvent = useCallback(async (calendarId: string, eventData: Parameters<typeof createHaEvent>[1]) => {
    if (calendarId === localCal.calendar.id) {
      localCal.createEvent(eventData);
    } else if (isGoogleCalendarId(calendarId)) {
      await gcal.createEvent(calendarId, eventData);
    } else {
      await createHaEvent(calendarId, eventData);
    }
  }, [localCal, gcal.createEvent, createHaEvent]);

  const updateEvent = useCallback(async (calendarId: string, uid: string, eventData: Parameters<typeof updateHaEvent>[2]) => {
    if (calendarId === localCal.calendar.id) {
      localCal.updateEvent(uid, eventData);
    } else if (isGoogleCalendarId(calendarId)) {
      await gcal.updateEvent(calendarId, uid, eventData);
    } else {
      await updateHaEvent(calendarId, uid, eventData);
    }
  }, [localCal, gcal.updateEvent, updateHaEvent]);

  const deleteEvent = useCallback(async (calendarId: string, uid: string) => {
    if (calendarId === localCal.calendar.id) {
      localCal.deleteEvent(uid);
    } else if (isGoogleCalendarId(calendarId)) {
      await gcal.deleteEvent(calendarId, uid);
    } else {
      await deleteHaEvent(calendarId, uid);
    }
  }, [localCal, gcal.deleteEvent, deleteHaEvent]);

  const { weather } = useWeather(client);
  const music = useMusic(client, connected);
  const {
    chores,
    completionsToday,
    completeChore,
    uncompleteChore,
  } = useChores();

  const dashboardTasks = useDashboardTasks(connected, settings.groceryListIds);
  const googleTasks = useGoogleTasks(googleEnabled);

  // Google Tasks first (they carry due dates), then HA / Beacon's own list.
  const todoItems = useMemo(
    () => [...googleTasks.items, ...dashboardTasks.items],
    [googleTasks.items, dashboardTasks.items],
  );
  const taskGroups = dashboardTasks.users.length > 0 ? dashboardTasks.users : googleTasks.groups;
  const { toggleItem: toggleDashboardTask } = dashboardTasks;
  const { toggle: toggleGoogleTask } = googleTasks;
  const handleToggleTodo = useCallback(
    (uid: string, currentStatus: string, listId?: string) => {
      if (isGoogleTaskList(listId)) return toggleGoogleTask(uid, currentStatus, listId);
      return toggleDashboardTask(uid, currentStatus, listId);
    },
    [toggleGoogleTask, toggleDashboardTask],
  );

  // Apply theme at App level so it stays active regardless of which view is shown
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme(settings.themeId);
  }, [settings.themeId, setTheme]);

  // Calendar-view visibility state. Seeded from the Settings-level
  // permanentlyHiddenCalendars list (source of truth) so calendars disabled
  // in Settings → Calendar are hidden here too, and kept in sync whenever
  // that setting changes (e.g. edited in another tab/session) rather than
  // only on first mount.
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<string>>(
    () => new Set(settings.permanentlyHiddenCalendars),
  );

  useEffect(() => {
    setHiddenCalendars(new Set(settings.permanentlyHiddenCalendars));
  }, [settings.permanentlyHiddenCalendars]);

  const visibleEvents = useMemo(
    () => events.filter((event) => !hiddenCalendars.has(event.calendarId)),
    [events, hiddenCalendars],
  );
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [prefillDate, setPrefillDate] = useState<string | null>(null);
  const [prefillTime, setPrefillTime] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<SidebarView>(
    (settings.defaultView as SidebarView) || 'dashboard'
  );

  // Kid Display (focus) mode — URL param wins, then device-local storage
  const [focusMemberId, setFocusMemberId] = useState<string | null>(() => getFocusMemberId());
  const focusMember = focusMemberId ? members.find((m) => m.id === focusMemberId) : undefined;

  // Escape hatch: if a display is assigned to a member but the family list
  // stays empty (fresh device, stale assignment), stop waiting after 10s and
  // fall through to the invalid-member banner instead of loading forever.
  const [focusLoadTimedOut, setFocusLoadTimedOut] = useState(false);
  useEffect(() => {
    if (!focusMemberId || members.length > 0) {
      setFocusLoadTimedOut(false);
      return;
    }
    const t = setTimeout(() => setFocusLoadTimedOut(true), 10_000);
    return () => clearTimeout(t);
  }, [focusMemberId, members.length]);

  const focusInvalid = !!focusMemberId && !focusMember && (members.length > 0 || focusLoadTimedOut);

  const handleExitFocus = useCallback(() => {
    clearFocusMode();
    setFocusMemberId(null);
  }, []);

  const handleEnterFocusMode = useCallback((memberId: string) => {
    setDeviceFocusMember(memberId);
    setFocusMemberId(memberId);
  }, []);

  // Visible week shown by the calendar (drives event fetch window)
  const [visibleWeekStart, setVisibleWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: settings.weekStartsOn }),
  );

  // Day currently selected on the Dashboard's day view
  const [dashboardDate, setDashboardDate] = useState<Date>(() => startOfDay(new Date()));

  // Google: the visible week AND the dashboard's "today + next 7 days", so
  // both views have data no matter which week the calendar is showing.
  const fetchGoogleEvents = gcal.fetchEvents;
  const refetchGoogleForWeek = useCallback(
    async (weekStart: Date) => {
      const today = startOfDay(new Date());
      const weekFrom = addDays(weekStart, -1);
      const weekTo = addDays(weekStart, 8);
      const from = weekFrom < addDays(today, -1) ? weekFrom : addDays(today, -1);
      const to = weekTo > addDays(today, 9) ? weekTo : addDays(today, 9);
      await fetchGoogleEvents(from.toISOString(), to.toISOString());
    },
    [fetchGoogleEvents],
  );

  // Helper: refetch events for a given week, with one extra day on either side
  // so multi-day events that bleed in/out of the visible week still render.
  const refetchEventsForWeek = useCallback(
    async (weekStart: Date) => {
      const rangeStart = addDays(weekStart, -1);
      const rangeEnd = addDays(weekStart, 8);
      await Promise.all([
        fetchEvents(rangeStart.toISOString(), rangeEnd.toISOString()),
        refetchGoogleForWeek(weekStart),
      ]);
    },
    [fetchEvents, refetchGoogleForWeek],
  );

  // Event notifications (browser + HA mobile_app)
  useNotifications(events, client, !focusMemberId, settings.notificationMinutes);

  // Leaderboard is still a slide-over panel (not a full view); Chores is now
  // a real full-screen activeView (see PRD: dedicated chores screen).
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Fetch data when connected, or when the user navigates to a different week.
  useEffect(() => {
    if (!connected) return;

    const loadData = async () => {
      await fetchCalendars();
      await refetchEventsForWeek(visibleWeekStart);
    };

    loadData();

    // Refresh every 5 minutes for the currently-visible week
    const interval = setInterval(() => {
      refetchEventsForWeek(visibleWeekStart);
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [connected, fetchCalendars, refetchEventsForWeek, visibleWeekStart]);

  // Google Calendar: load on start / week change, every 5 minutes, and when
  // the tablet wakes up.
  const fetchGoogleCalendars = gcal.fetchCalendars;
  useEffect(() => {
    if (!googleEnabled) return;

    const load = async () => {
      await fetchGoogleCalendars();
      await refetchGoogleForWeek(visibleWeekStart);
    };
    load();

    const interval = setInterval(() => {
      refetchGoogleForWeek(visibleWeekStart);
    }, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetchGoogleForWeek(visibleWeekStart);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [googleEnabled, bridgeCfg.url, bridgeCfg.key, fetchGoogleCalendars, refetchGoogleForWeek, visibleWeekStart]);

  // Re-fetch when calendar colors or family members change so colors update
  // immediately, without recreating the 5-minute polling interval above.
  const colorRefreshRef = useRef({ connected, fetchCalendars, refetchEventsForWeek, visibleWeekStart });
  colorRefreshRef.current = { connected, fetchCalendars, refetchEventsForWeek, visibleWeekStart };
  const didColorRefreshMount = useRef(false);
  useEffect(() => {
    if (!didColorRefreshMount.current) {
      didColorRefreshMount.current = true;
      return;
    }
    if (!colorRefreshRef.current.connected) return;
    colorRefreshRef.current.fetchCalendars();
    colorRefreshRef.current.refetchEventsForWeek(colorRefreshRef.current.visibleWeekStart);
  }, [settings.calendarColors, members]);

  const handleToggleCalendar = useCallback((calendarId: string) => {
    setHiddenCalendars(prev => {
      const next = new Set(prev);
      if (next.has(calendarId)) {
        next.delete(calendarId);
      } else {
        next.add(calendarId);
      }
      // Persist to Settings so the Calendar-view selection survives
      // navigation/remount and reload — settings.permanentlyHiddenCalendars
      // is the single source of truth for calendar visibility.
      updateSettings({ permanentlyHiddenCalendars: Array.from(next) });
      return next;
    });
  }, [updateSettings]);

  const handleEventClick = useCallback((event: CalendarEvent) => {
    setSelectedEvent(event);
    setPrefillDate(null);
    setPrefillTime(null);
    setShowModal(true);
  }, []);

  const handleSlotClick = useCallback((date: string, hour: number) => {
    setSelectedEvent(null);
    setPrefillDate(date);
    setPrefillTime(`${String(hour).padStart(2, '0')}:00`);
    setShowModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    setSelectedEvent(null);
    setPrefillDate(null);
    setPrefillTime(null);
  }, []);

  const handleSaveEvent = useCallback(async (calendarId: string, data: EventFormData) => {
    const eventData = data.allDay
      ? {
          summary: data.summary,
          start_date: data.startDate,
          // HA's calendar API treats dtend as exclusive (the day AFTER the
          // last day of the event) and rejects dtstart === dtend with a
          // "minimum event duration" error. When the user picks the same
          // start/end date for a single-day all-day event, bump end_date to
          // the day after start_date so HA sees a valid >=1-day duration.
          end_date: data.endDate <= data.startDate
            ? format(addDays(new Date(`${data.startDate}T00:00:00`), 1), 'yyyy-MM-dd')
            : data.endDate,
          description: data.description || undefined,
        }
      : {
          summary: data.summary,
          start_date_time: `${data.startDate}T${data.startTime}:00`,
          end_date_time: `${data.endDate}T${data.endTime}:00`,
          description: data.description || undefined,
        };

    // Build rrule if recurrence is set
    if (data.recurrence && data.recurrence !== 'none') {
      const freqMap = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' } as const;
      const freq = freqMap[data.recurrence];
      const until = data.recurrenceEnd.replace(/-/g, '') + 'T235959Z';
      (eventData as Record<string, unknown>).rrule = `FREQ=${freq};UNTIL=${until}`;
    }

    try {
      if (selectedEvent) {
        // Editing an existing event — update in place rather than creating
        // a duplicate. `selectedEvent.calendarId` is the event's original
        // calendar; if the user changed the calendar in the form, move it
        // by deleting from the old calendar and creating on the new one
        // (HA's update_event can't move an event across entities).
        if (selectedEvent.hasStableId === false) {
          throw new Error("This event can't be edited — it has no stable ID from its calendar provider.");
        }
        if (calendarId !== selectedEvent.calendarId) {
          await deleteEvent(selectedEvent.calendarId, selectedEvent.id);
          await createEvent(calendarId, eventData);
        } else {
          try {
            await updateEvent(calendarId, selectedEvent.id, eventData);
          } catch (err) {
            // Many calendar providers (Google Calendar via HA, several
            // CalDAV backends, etc.) don't support in-place event updates
            // at all. Fall back to delete + recreate so editing still
            // works — the event gets a new id, but that's invisible to
            // the user since we refetch right after.
            if (err instanceof CalendarNotSupportedError) {
              await deleteEvent(calendarId, selectedEvent.id);
              await createEvent(calendarId, eventData);
            } else {
              throw err;
            }
          }
        }
      } else {
        await createEvent(calendarId, eventData);
      }

      await refetchEventsForWeek(visibleWeekStart);

      handleCloseModal();
    } catch (err) {
      console.error('Failed to save event:', err);
      // Re-throw so EventModal can surface an inline error to the user
      // instead of the save silently appearing to do nothing.
      throw err;
    }
  }, [selectedEvent, createEvent, updateEvent, deleteEvent, refetchEventsForWeek, visibleWeekStart, handleCloseModal]);

  const handleDeleteEvent = useCallback(async (calendarId: string, eventId: string) => {
    try {
      if (selectedEvent && selectedEvent.id === eventId && selectedEvent.hasStableId === false) {
        throw new Error("This event can't be deleted — it has no stable ID from its calendar provider.");
      }
      await deleteEvent(calendarId, eventId);

      await refetchEventsForWeek(visibleWeekStart);

      handleCloseModal();
    } catch (err) {
      console.error('Failed to delete event:', err);
      throw err instanceof CalendarNotSupportedError
        ? new Error('This calendar does not support deleting events.')
        : err;
    }
  }, [selectedEvent, deleteEvent, refetchEventsForWeek, visibleWeekStart, handleCloseModal]);

  const handleEventReschedule = useCallback(async (event: CalendarEvent, newDate: string, newHour: number) => {
    try {
      const oldStart = new Date(event.start);
      const oldEnd = new Date(event.end);
      const durationMs = oldEnd.getTime() - oldStart.getTime();

      const patch = event.allDay
        ? {
            start_date: newDate,
            end_date: format(new Date(new Date(newDate).getTime() + durationMs), 'yyyy-MM-dd'),
          }
        : (() => {
            const pad = (n: number) => String(n).padStart(2, '0');
            const newStartDt = `${newDate}T${pad(newHour)}:00:00`;
            const newEndTime = new Date(new Date(newStartDt).getTime() + durationMs);
            const newEndDt = `${format(newEndTime, 'yyyy-MM-dd')}T${pad(newEndTime.getHours())}:${pad(newEndTime.getMinutes())}:00`;
            return { start_date_time: newStartDt, end_date_time: newEndDt };
          })();

      try {
        await updateEvent(event.calendarId, event.id, patch);
      } catch (err) {
        // Same fallback as handleSaveEvent: calendars without update
        // support need delete + recreate to move an event via drag.
        if (err instanceof CalendarNotSupportedError) {
          await deleteEvent(event.calendarId, event.id);
          await createEvent(event.calendarId, { ...patch, summary: event.title, description: event.description });
        } else {
          throw err;
        }
      }

      await refetchEventsForWeek(visibleWeekStart);
    } catch (err) {
      console.error('Failed to reschedule event:', err);
    }
  }, [updateEvent, deleteEvent, createEvent, refetchEventsForWeek, visibleWeekStart]);

  const handleAddEvent = useCallback(() => {
    setSelectedEvent(null);
    // Default new events to the day currently selected on the dashboard.
    setPrefillDate(activeView === 'dashboard' ? format(dashboardDate, 'yyyy-MM-dd') : null);
    setPrefillTime(null);
    setShowModal(true);
  }, [activeView, dashboardDate]);

  const handleChangeView = useCallback(
    (view: SidebarView) => {
      // Leaderboard opens as an overlay, doesn't change the main view.
      // Chores is a real activeView now (dedicated full-screen view).
      if (view === 'leaderboard') {
        setShowLeaderboard(true);
        return;
      }
      // All other views: close any open panel and switch view
      setShowLeaderboard(false);
      setActiveView(view);
    },
    [],
  );

  const handleClosePanel = useCallback(() => {
    setShowLeaderboard(false);
  }, []);

  // Build a set of chore IDs completed today (for the dashboard checklist).
  // We use the first member for now; a member-picker could be added later.
  const firstMemberId = members.length > 0 ? members[0].id : '__none__';
  const completedChoreIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of completionsToday) {
      if (c.member_id === firstMemberId) {
        ids.add(c.chore_id);
      }
    }
    return ids;
  }, [completionsToday, firstMemberId]);

  const handleToggleChore = useCallback(
    (choreId: string) => {
      if (completedChoreIds.has(choreId)) {
        uncompleteChore(choreId, firstMemberId);
      } else {
        completeChore(choreId, firstMemberId);
      }
    },
    [completedChoreIds, completeChore, uncompleteChore, firstMemberId]
  );

  // Handle onboarding completion
  const handleOnboardingComplete = useCallback(async (haUrl: string, haToken: string) => {
    await auth.saveManualToken(haUrl, haToken);
    patchConfig({ ha_url: haUrl, ha_token: haToken });
    window.location.reload();
  }, [auth]);

  const handleOAuthStart = useCallback((haUrl: string) => {
    auth.startOAuth(haUrl);
  }, [auth]);

  // Keyboard shortcuts for quick view switching
  useEffect(() => {
    const viewMap: Record<string, SidebarView> = {
      '1': 'dashboard',
      '2': 'calendar',
      '3': 'chores',
      '4': 'grocery',
      '5': 'tasks',
      '6': 'leaderboard',
      '7': 'music',
      '8': 'photos',
      '9': 'timer',
      '0': 'settings',
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const view = viewMap[e.key];
      if (view) {
        e.preventDefault();
        setActiveView(view);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const sidebarPos = settings.sidebarPosition || 'left';

  // Show loading screen while checking stored credentials
  if (auth.state.loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
      </div>
    );
  }

  // Show onboarding ONLY when running as a standalone app with no HA connection configured.
  // Skip if: __BEACON_CONFIG__ exists (add-on injected it), or env token set, or already onboarded,
  // or running in an iframe (HA ingress), or URL has /ingress/ path.
  const isHaManaged = !!(
    window.__BEACON_CONFIG__ ||
    import.meta.env.VITE_HA_TOKEN ||
    window !== window.parent ||
    window.location.pathname.includes('/ingress/')
  );
  if (!isHaManaged && !auth.state.isOnboarded) {
    // Running on its own: offer the Google setup first; Home Assistant sign-in
    // is still one tap away for anyone who has it.
    if (showHaOnboarding) {
      return (
        <OnboardingView
          onComplete={handleOnboardingComplete}
          onOAuthStart={handleOAuthStart}
        />
      );
    }
    if (!bridgeCfg.setupDone) {
      return <GoogleSetupView onUseHomeAssistant={() => setShowHaOnboarding(true)} />;
    }
  }

  // Kid Display mode: replace the entire shell (same pattern as onboarding)
  if (focusMember) {
    return (
      <FocusView
        memberId={focusMember.id}
        settings={settings}
        onExit={handleExitFocus}
      />
    );
  }

  // Focus member requested but members not loaded yet (fresh device cache):
  // hold on a lightweight loading screen instead of flashing the full app.
  if (focusMemberId && members.length === 0 && !focusLoadTimedOut) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
      </div>
    );
  }

  return (
    <I18nContext.Provider value={i18n}>
    <div className={`beacon ${settings.kioskMode ? 'beacon--kiosk' : `beacon--sidebar-${sidebarPos}`} ${isIngress ? 'beacon--ingress' : ''} ${compact ? 'beacon--compact' : ''}`}>
      {focusInvalid && (
        <div className="focus-invalid-banner">
          {t('app.kidDisplayNotFound')}
          <button type="button" className="settings-btn" onClick={handleExitFocus}>
            {t('app.dismiss')}
          </button>
        </div>
      )}
      {/* Sidebar — hidden entirely in Kiosk Mode (Settings > Display) */}
      {!settings.kioskMode && (
        <Sidebar
          activeView={activeView}
          onChangeView={handleChangeView}
          position={sidebarPos}
        />
      )}

      {/* Main content area */}
      <div className="beacon-main">
        {activeView === 'dashboard' && settings.dashboardLayout === 'default' ? (
          <WallView
            events={events}
            hiddenCalendars={hiddenCalendars}
            onEventClick={handleEventClick}
            onSlotClick={handleSlotClick}
            onEventReschedule={handleEventReschedule}
            onVisibleWeekChange={setVisibleWeekStart}
            weekStartsOn={settings.weekStartsOn}
            timeFormat={settings.timeFormat}
            weather={weather}
            todoItems={todoItems}
            taskGroups={taskGroups}
            onToggleTodo={handleToggleTodo}
            onAddEvent={handleAddEvent}
            onOpenWeather={() => setActiveView('weather')}
            onOpenNews={() => setActiveView('news')}
            onOpenTasks={() => setActiveView('tasks')}
            onOpenSettings={() => setActiveView('settings')}
            newsEnabled={googleEnabled}
          />
        ) : activeView === 'dashboard' ? (
          <>
            <DashboardView
              events={visibleEvents}
              weather={weather}
              chores={settings.choresEnabled ? chores : []}
              completedChoreIds={completedChoreIds}
              onToggleChore={handleToggleChore}
              todoItems={todoItems}
              onToggleTodo={handleToggleTodo}
              onWeatherClick={() => setActiveView('weather')}
              onNewsClick={googleEnabled ? () => setActiveView('news') : undefined}
              onEventClick={handleEventClick}
              members={members}
              taskmateUsers={taskGroups}
              layout={settings.dashboardLayout}
              advancedDashboard={settings.advancedDashboard}
              timeFormat={settings.timeFormat}
              selectedDate={dashboardDate}
              onSelectedDateChange={setDashboardDate}
            />
            <OmniAdd
              onAddEvent={handleAddEvent}
              onAddGroceryItem={() => setActiveView('grocery')}
              onAddChore={() => handleChangeView('chores')}
              onNavigateTimer={() => setActiveView('timer')}
              sidebarPosition={sidebarPos}
            />
          </>
        ) : activeView === 'chores' ? (
          settings.choresEnabled ? (
            <ChoresView />
          ) : (
            <div className="chores-empty" style={{ padding: 48 }}>
              {t('app.choresDisabled')}
            </div>
          )
        ) : activeView === 'music' ? (
          <MusicView
            activePlayer={music.activePlayer}
            players={music.players}
            selectedPlayerId={music.selectedPlayerId}
            onPlay={music.play}
            onPause={music.pause}
            onNext={music.next}
            onPrevious={music.previous}
            onSetVolume={music.setVolume}
            onSelectPlayer={music.selectPlayer}
          />
        ) : activeView === 'settings' ? (
          <SettingsView
            settings={settings}
            onUpdateSettings={updateSettings}
            onResetSettings={resetSettings}
            onExportSettings={exportSettings}
            onImportSettings={importSettings}
            onClearLocalStorage={clearLocalStorage}
            members={members}
            onAddMember={addMember}
            onUpdateMember={updateMember}
            onRemoveMember={removeMember}
            connected={connected}
            haUrl={config.ha_url}
            calendars={calendars}
            onEnterFocusMode={handleEnterFocusMode}
          />
        ) : activeView === 'grocery' ? (
          <GroceryView defaultListId={settings.defaultGroceryList || undefined} mode="grocery" groceryListIds={settings.groceryListIds} />
        ) : activeView === 'tasks' ? (
          <GroceryView mode="tasks" groceryListIds={settings.groceryListIds} />
        ) : activeView === 'timer' ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
            <Timer />
          </div>
        ) : activeView === 'weather' ? (
          <WeatherView />
        ) : activeView === 'news' ? (
          <NewsView />
        ) : activeView === 'photos' ? (
          <PhotoFrame
            musicPlayer={music.activePlayer}
            onMusicPlay={() => music.activePlayer && music.play(music.activePlayer.entity_id)}
            onMusicPause={() => music.activePlayer && music.pause(music.activePlayer.entity_id)}
            onMusicNext={() => music.activePlayer && music.next(music.activePlayer.entity_id)}
            onMusicPrevious={() => music.activePlayer && music.previous(music.activePlayer.entity_id)}
            onMusicSetVolume={(v) => music.activePlayer && music.setVolume(v, music.activePlayer.entity_id)}
            onBack={() => setActiveView('dashboard')}
          />
        ) : (
          <>
            {/* Header */}
            <header className="beacon-header">
              <div className="header-left">
                <span className="header-family-name">{settings.familyName}</span>
                <span className="header-separator" />
                <span className="header-date">{format(new Date(), 'EEEE, MMMM d, yyyy', { locale: i18n.dateLocale })}</span>
                {!connected && !googleEnabled && (
                  <div className="connection-status">
                    <span className="connection-dot" />
                    {t('app.connecting')}
                  </div>
                )}
              </div>
              <div className="header-right">
                <Clock />
              </div>
            </header>

            {/* Family filter pills — above the calendar */}
            <div className="filter-bar">
              <FamilyFilter
                calendars={calendars}
                hiddenCalendars={hiddenCalendars}
                onToggle={handleToggleCalendar}
              />
            </div>

            {/* Calendar Body — two-column on desktop */}
            <div className="beacon-body beacon-body--two-col">
              <div className="beacon-body-calendar">
                <WeekCalendar
                  events={events}
                  hiddenCalendars={hiddenCalendars}
                  onEventClick={handleEventClick}
                  onSlotClick={handleSlotClick}
                  onEventReschedule={handleEventReschedule}
                  onVisibleWeekChange={setVisibleWeekStart}
                  weekStartsOn={settings.weekStartsOn}
                />
              </div>
              <CalendarSidebar
                events={visibleEvents}
                chores={settings.choresEnabled ? chores : []}
                completedChoreIds={completedChoreIds}
                onToggleChore={handleToggleChore}
                todoItems={todoItems}
                onToggleTodo={handleToggleTodo}
                members={members}
              />
            </div>

            {/* Omni-Add FAB */}
            <OmniAdd
              onAddEvent={handleAddEvent}
              onAddGroceryItem={() => setActiveView('grocery')}
              onAddChore={() => handleChangeView('chores')}
              onNavigateTimer={() => setActiveView('timer')}
              sidebarPosition={sidebarPos}
            />
          </>
        )}
      </div>

      {/* Event Modal */}
      {showModal && (
        <EventModal
          event={selectedEvent}
          calendars={calendars}
          defaultCalendarId={
            settings.defaultCalendar && calendars.some((c) => c.id === settings.defaultCalendar)
              ? settings.defaultCalendar
              : gcal.primaryCalendarId ?? settings.defaultCalendar
          }
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
          onClose={handleCloseModal}
          prefillDate={prefillDate}
          prefillTime={prefillTime}
        />
      )}

      {/* Leaderboard Slide Panel */}
      <Leaderboard
        open={showLeaderboard}
        onClose={handleClosePanel}
      />
      {showLeaderboard && (
        <div
          className="slide-panel-backdrop"
          onClick={handleClosePanel}
        />
      )}

      {/* GroceryView is now rendered as a full view above */}

      {/* Now Playing Bar — shows when music is playing, hidden in photo/music views */}
      {activeView !== 'music' && activeView !== 'photos' && music.activePlayer?.state === 'playing' && (
        <NowPlayingBar
          player={music.activePlayer}
          onPlay={() => music.play(music.activePlayer!.entity_id)}
          onPause={() => music.pause(music.activePlayer!.entity_id)}
          onNext={() => music.next(music.activePlayer!.entity_id)}
          onPrevious={() => music.previous(music.activePlayer!.entity_id)}
          onSetVolume={(v) => music.setVolume(v, music.activePlayer!.entity_id)}
          onExpand={() => setActiveView('music')}
        />
      )}

      {/* Screen saver / dim mode */}
      <ScreenSaver
        enabled={settings.screenSaverEnabled}
        dimTimeoutMin={settings.dimTimeout}
        screenSaverTimeoutMin={settings.screenSaverTimeout}
      />

      {/* Demo indicator — only show outside of add-on ingress */}
      {!connected && !isHaManaged && !googleEnabled && (
        <div className="demo-badge">{t('app.demoMode')}</div>
      )}
    </div>
    </I18nContext.Provider>
  );
}

import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus } from 'lucide-react';
import { CalendarEvent, WeatherData } from '../types';
import { TodoItem } from '../types/dashboard-cards';
import type { TaskmateUser } from '../types/taskmate';
import { WeekCalendar } from './WeekCalendar';
import { TaskGroups } from './cards/TasksCard';
import { Headlines } from './cards/NewsCard';
import { weatherIcon, conditionLabel } from '../types/weather-icons';
import { useTranslation } from '../i18n';

interface WallViewProps {
  events: CalendarEvent[];
  hiddenCalendars: Set<string>;
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (date: string, hour: number) => void;
  onEventReschedule?: (event: CalendarEvent, newDate: string, newHour: number) => void;
  onVisibleWeekChange?: (weekStart: Date) => void;
  weekStartsOn: 0 | 1;
  timeFormat: '12h' | '24h';
  weather: WeatherData | null;
  todoItems: TodoItem[];
  taskGroups: TaskmateUser[];
  onToggleTodo: (uid: string, currentStatus: string, listId?: string) => void;
  onAddEvent: () => void;
  onOpenWeather: () => void;
  onOpenNews: () => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  newsEnabled: boolean;
}

/**
 * Home screen for a wall tablet: the week calendar fills the left side and a
 * single right-hand column holds action items, weather and news, all visible
 * at once. In portrait the column moves under the calendar as three panels.
 */
export function WallView({
  events,
  hiddenCalendars,
  onEventClick,
  onSlotClick,
  onEventReschedule,
  onVisibleWeekChange,
  weekStartsOn,
  timeFormat,
  weather,
  todoItems,
  taskGroups,
  onToggleTodo,
  onAddEvent,
  onOpenWeather,
  onOpenNews,
  onOpenTasks,
  onOpenSettings,
  newsEnabled,
}: WallViewProps) {
  const { t, dateLocale } = useTranslation();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);

  const openCount = todoItems.filter((i) => i.status === 'needs_action').length;
  const today = format(now, 'yyyy-MM-dd');
  const upcoming = (weather?.forecast ?? []).filter((d) => d.date >= today).slice(0, 5);

  return (
    <div className="wall">
      <header className="wall-header">
        <div className="wall-header-left">
          <span className="wall-time">{format(now, timeFormat === '24h' ? 'HH:mm' : 'h:mm a', { locale: dateLocale })}</span>
          <span className="wall-date">{format(now, 'EEEE, MMMM d', { locale: dateLocale })}</span>
        </div>
        <button type="button" className="wall-add" onClick={onAddEvent}>
          <Plus size={18} /> {t('omniAdd.event')}
        </button>
      </header>

      <div className="wall-calendar">
        <WeekCalendar
          events={events}
          hiddenCalendars={hiddenCalendars}
          onEventClick={onEventClick}
          onSlotClick={onSlotClick}
          onEventReschedule={onEventReschedule}
          onVisibleWeekChange={onVisibleWeekChange}
          weekStartsOn={weekStartsOn}
        />
      </div>

      <aside className="wall-side">
        <section className="wall-panel wall-panel--tasks">
          <h3 className="wall-panel-heading">
            <button type="button" className="wall-panel-heading-btn" onClick={onOpenTasks}>
              Action items{openCount > 0 ? ` · ${openCount}` : ''} <span aria-hidden="true">›</span>
            </button>
          </h3>
          <div className="wall-panel-body">
            {todoItems.length > 0 ? (
              <TaskGroups items={todoItems} users={taskGroups} onToggleTodo={onToggleTodo} />
            ) : (
              <div className="wall-empty">Nothing open. Nice work.</div>
            )}
          </div>
        </section>

        <section className="wall-panel wall-panel--weather">
          <h3 className="wall-panel-heading">
            <button type="button" className="wall-panel-heading-btn" onClick={weather ? onOpenWeather : onOpenSettings}>
              {t('nav.weather')} <span aria-hidden="true">›</span>
            </button>
          </h3>
          {weather ? (
            <div className="wall-weather" onClick={onOpenWeather} role="button" tabIndex={0}
              onKeyDown={(e: { key: string }) => { if (e.key === 'Enter') onOpenWeather(); }}>
              <div className="wall-weather-now">
                <span className="wall-weather-icon">{weatherIcon(weather.condition)}</span>
                <span className="wall-weather-temp">{Math.round(weather.temperature)}°</span>
                <span className="wall-weather-cond">
                  {conditionLabel(weather.condition, t)}
                  {upcoming[0] && upcoming[0].date === today && (
                    <span className="wall-weather-hilo">H {Math.round(upcoming[0].tempHigh)}° · L {Math.round(upcoming[0].tempLow)}°</span>
                  )}
                </span>
              </div>
              {upcoming.length > 1 && (
                <div className="wall-forecast">
                  {upcoming.slice(upcoming[0].date === today ? 1 : 0, 5).map((d) => (
                    <div key={d.date} className="wall-forecast-day">
                      <span className="wall-forecast-name">{format(parseISO(d.date), 'EEE', { locale: dateLocale })}</span>
                      <span className="wall-forecast-icon">{weatherIcon(d.condition)}</span>
                      <span className="wall-forecast-temps">{Math.round(d.tempHigh)}°<span> {Math.round(d.tempLow)}°</span></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="wall-empty">Set your city in Settings → Google &amp; News.</div>
          )}
        </section>

        <section className="wall-panel wall-panel--news">
          <h3 className="wall-panel-heading">
            <button type="button" className="wall-panel-heading-btn" onClick={newsEnabled ? onOpenNews : onOpenSettings}>
              {t('nav.news')} <span aria-hidden="true">›</span>
            </button>
          </h3>
          <div className="wall-panel-body">
            <Headlines max={10} />
          </div>
        </section>
      </aside>
    </div>
  );
}

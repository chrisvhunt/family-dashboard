import { format, parseISO, addDays, isSameDay } from 'date-fns';
import { X, MapPin } from 'lucide-react';
import { CalendarEvent } from '../types';
import { useTranslation } from '../i18n';

interface EventDetailsProps {
  event: CalendarEvent;
  timeFormat: '12h' | '24h';
  onClose: () => void;
}

/** Read-only details for a Google Calendar event (the dashboard can't change Google data). */
export function EventDetails({ event, timeFormat, onClose }: EventDetailsProps) {
  const { dateLocale } = useTranslation();
  const start = parseISO(event.start);
  const end = parseISO(event.end);
  const timeFmt = timeFormat === '24h' ? 'HH:mm' : 'h:mm a';
  const dayFmt = 'EEEE, MMMM d';

  let when: string;
  if (event.allDay) {
    const lastDay = addDays(end, -1); // all-day end dates are exclusive
    when = isSameDay(start, lastDay) || lastDay < start
      ? `${format(start, dayFmt, { locale: dateLocale })} · All day`
      : `${format(start, dayFmt, { locale: dateLocale })} – ${format(lastDay, dayFmt, { locale: dateLocale })}`;
  } else if (isSameDay(start, end)) {
    when = `${format(start, dayFmt, { locale: dateLocale })} · ${format(start, timeFmt, { locale: dateLocale })} – ${format(end, timeFmt, { locale: dateLocale })}`;
  } else {
    when = `${format(start, `${dayFmt} ${timeFmt}`, { locale: dateLocale })} – ${format(end, `${dayFmt} ${timeFmt}`, { locale: dateLocale })}`;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal event-details" onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()} role="dialog" aria-label={event.title}>
        <div className="modal-header">
          <h2 className="modal-title event-details-title">
            <span className="event-details-dot" style={{ background: event.color }} aria-hidden="true" />
            {event.title}
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body event-details-body">
          <div className="event-details-when">{when}</div>
          {event.location && (
            <div className="event-details-row">
              <MapPin size={16} /> {event.location}
            </div>
          )}
          <div className="event-details-calendar">{event.calendarName}</div>
          {event.description && <p className="event-details-desc">{event.description}</p>}
          <p className="event-details-note">View only. To change this event, use Google Calendar on your phone or computer.</p>
        </div>
      </div>
    </div>
  );
}

# Family Dashboard: setup guide

This is a customized fork of [Beacon](https://github.com/asachs01/beacon) (MIT license). It runs **without Home Assistant** and shows:

- **Google Calendar.** All the calendars you have checked in Google Calendar, color-coded. You can add events from the tablet.
- **Google Tasks.** Your open action items with due-date badges (Overdue / Today / Tomorrow). Tap to check one off.
- **Weather.** Current conditions plus a 7-day and hourly forecast from Open-Meteo. No account needed.
- **News.** Top US headlines, local news for your city, and any topics you add. Stories under an hour old get a red **New** tag.
- **Blackhawks.** Live score, last result and next game. You can pick any NHL team, or none.

**Home screen:** the week calendar fills the left side, with one column on the right for action items, weather and news. Held upright, the three panels move under the calendar. Tap a panel's title to open its full screen.

Setup has three parts and takes about 20 minutes.

---

## Part 1: Create the Google bridge (10 min)

The bridge is a small script that runs in your own Google account. It gives the dashboard your calendar, tasks and news. Nobody else hosts or sees your data.

1. Go to **https://script.google.com** and click **New project**. Name it `Beacon Google Bridge`.
2. Click the **gear icon (Project Settings)** and tick **Show "appsscript.json" manifest file in editor**.
3. Go back to the **Editor** (the `< >` icon):
   - Open `Code.gs`, delete what's there, and paste in the contents of `google-bridge/Code.gs` from this project.
   - Open `appsscript.json`, delete what's there, and paste in `google-bridge/appsscript.json`.
     It's set to Central time (`America/Chicago`). Change `timeZone` if you're somewhere else.
   - Click **Save** (the disk icon).
4. In the function dropdown at the top, pick **`setup`** and click **Run**.
   - Google asks for permission. Click **Review permissions**, choose your account, then **Advanced → Go to Beacon Google Bridge (unsafe)** → **Allow**.
     It says "unsafe" only because you wrote the script yourself and Google hasn't reviewed it.
   - When it finishes, open **Execution log**. **Copy the key** it printed (a long string of letters and numbers).
5. Click **Deploy → New deployment**:
   - Click the gear next to "Select type" and choose **Web app**.
   - **Execute as:** Me. **Who has access:** Anyone.
   - Click **Deploy** and **copy the Web app URL**. It ends in `/exec`.

> **Why "Anyone"?** The tablet has to reach the script without signing in to Google. Every request still needs your secret key, so keep the key private. If it ever leaks, run `rotateKey` in the script editor and enter the new key on the tablet.

**Changing the script later:** paste in the new code, then go to **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The URL stays the same.

---

## Part 2: Publish the dashboard on GitHub Pages (5 min)

GitHub Pages is free for public repositories. That's safe here: the code has no secrets in it, and your key and URL are stored only on the tablet.

**Using GitHub Desktop (easiest on Windows):**

1. Unzip this project somewhere, e.g. `Documents\family-dashboard`.
2. In GitHub Desktop: **File → Add local repository**, then pick that folder. When it says it isn't a Git repository, click **create a repository**, then **Create repository**.
3. Click **Publish repository**. **Untick "Keep this code private"**, then click **Publish**.
4. On github.com, open the new repository:
   - **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   - Open the **Actions** tab. If asked, click **I understand my workflows, go ahead and enable them**.
   - Open **Deploy dashboard to GitHub Pages** and click **Run workflow**. It takes about 2 minutes.
5. Your dashboard is now live at `https://YOUR-USERNAME.github.io/REPO-NAME/`.

Every time you push a change, the site rebuilds by itself.

---

## Part 3: Set up the tablet (5 min)

1. **Make a one-tap setup link** on your PC. Put your three values together like this (no spaces):

   ```
   https://YOUR-USERNAME.github.io/REPO-NAME/?bridge=WEB-APP-URL&key=YOUR-KEY
   ```

   Email or text it to yourself and open it **in Chrome on the tablet**. It fills in the connection for you, then removes the key from the address bar.
   You can also open the plain site address and paste the URL and key into the setup screen.
2. On the setup screen:
   - Click **Test & save**. You should see "Connected".
   - Under **Location**, search for your city and tap it. This sets the weather and adds a local news feed.
   - Under **News & topics**, add any topics you want (e.g. *Iowa Hawkeyes*, *AI*, *gardening*). Each topic becomes its own column.
   - Tap **Open dashboard**.
3. **Install it full-screen:** Chrome menu **⋮ → Add to Home screen → Install**. Launch it from the home-screen icon and it fills the whole screen.
4. **Keep the screen on:**
   - Option 1: Android **Settings → Display → Screen timeout**, set to the longest option.
   - Option 2: Turn on **Developer options → Stay awake** (keeps the screen on while charging).
   - Beacon's own screen saver and dimming are under **Settings → Display**.
5. **Optional tidying in Beacon's Settings:**
   - **Calendar:** hide the built-in "Beacon" calendar if you only use Google.
   - **Family Members:** add each person and link their Google calendar so events are colored by person.
   - **Display → Kiosk mode:** hides the side menu for a cleaner wall display.

---

## Good to know

- **Repeating events:** you can create them on the dashboard, but edit or delete them in the Google Calendar app. The dashboard explains this if you try.
- **Adding tasks:** add them in the Google Tasks app on your phone (or Gmail/Calendar's task panel). They appear on the wall within 2 minutes. Due dates sort to the top.
- **Refresh rates:**
  - Calendar: every 5 minutes, and whenever the tablet wakes up.
  - Tasks: every 2 minutes.
  - Weather: every 10 minutes.
  - News: every 10 minutes.
  - NHL score: every 5 minutes, and every minute during a live game.
- **Reminders:** Beacon can show notifications before events (**Settings → Calendar**) if you allow notifications in Chrome.
- **Where settings live:** Google & News settings are stored in the tablet's browser. If you clear Chrome's data, open your setup link again.

## What changed from upstream Beacon

| Area | Files |
| --- | --- |
| Google bridge (Apps Script) | `google-bridge/Code.gs`, `google-bridge/appsscript.json` |
| Bridge client + config | `src/api/google-bridge.ts`, `src/hooks/useBridgeConfig.ts` |
| Google Calendar | `src/hooks/useGoogleCalendar.ts`, wired in `src/App.tsx` |
| Google Tasks + due dates | `src/hooks/useGoogleTasks.ts`, `src/components/cards/TasksCard.tsx` |
| Weather without Home Assistant | `src/api/open-meteo.ts`, `src/hooks/useWeather*.ts`, `src/components/WeatherView.tsx` |
| News + NHL | `src/hooks/useNews.ts`, `src/components/NewsView.tsx`, `src/components/cards/NewsCard.tsx` |
| Setup + settings | `src/components/GoogleSetupView.tsx`, `src/components/GoogleSettingsPanel.tsx`, `src/components/SettingsView.tsx` |
| Hosting | `.github/workflows/deploy-pages.yml`, `public/manifest.json` |

Home Assistant still works if you ever add it later. Choose **"I use Home Assistant instead"** on the setup screen.

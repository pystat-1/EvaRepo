# Privacy statement — Eva Desktop and the Eva evaluator app

Eva manages clinical training data (students, groups, schedules and daily
grades) for a nursing college.

## Eva Desktop (Windows)

- **Your data stays on your computer.** All records live in one database file
  in the app's data folder, with automatic backups next to it. Eva Desktop has
  no account with us and sends no usage statistics or crash reports anywhere.
- **Sync with evaluators' phones is off until you turn it on.** Data leaves the
  computer only after you enter a sync server's address and administrator key
  (المزامنة screen). From then on it exchanges exactly what the evaluator app
  needs with **that server only**: each evaluator's email, name, groups,
  students, schedule, criteria and previously validated days, and it receives
  the days evaluators validate on their phones. Removing the key stops it.
- **Update checks** ask this repository's GitHub Releases whether a newer
  version exists. The request carries no personal or training data; GitHub
  sees an ordinary download request. Updates are installed only when you
  choose to, after a backup.
- **Diagnostic reports** are text files you save and send yourself. They hold
  technical facts and the app's log, and no student data.

## Eva evaluator app (phone)

- Evaluators sign in with the Google account of the email the administrator
  registered. Google tells the sync server that the person controls that
  email; the app receives no Google password and no other Google data.
- The phone stores the evaluator's schedule, students and drafts so it works
  offline, and sends validated days to the same sync server.

## Contact

Questions: open an issue on [the project's GitHub page](https://github.com/pystat-1/EvaRepo/issues).

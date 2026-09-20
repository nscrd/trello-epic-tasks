# Epic Tasks für Trello

Ein Trello Power-Up, das Karten wie Jira-Epics gruppiert: Ein **Epic** hat mehrere **Tasks**, der Fortschritt wird am Epic angezeigt.

**Ohne REST-API, ohne Autorisierung, ohne Server.** Alle Daten liegen in den Plugin-Daten der Karten, gelesen wird über `t.cards()`. Das Power-Up arbeitet immer nur **innerhalb eines Boards**.

Inspiriert von [lode/trello-epic-relations](https://github.com/lode/trello-epic-relations) (MIT). Übernommen wurde nur die Idee (Parent/Child in den Plugin-Daten der Karten, Kopie-Erkennung über eine `owner`-ID). Der Code ist eine eigene Implementierung ohne REST-API.

## Funktionen

- **Am Epic:** Button *Tasks hinzufügen* (Suche über alle Karten des Boards). Ist eine Karte schon in einem anderen Epic, wird sie verschoben.
- **Am Epic:** Fortschritt als Badge auf der Karte (`3/7 Tasks`, grün bei 100 %) und als Abschnitt auf der Rückseite mit Fortschrittsbalken, Task-Liste, Klick öffnet die Task, ✕ entfernt sie aus dem Epic.
- **An der Task:** Button *Epic zuweisen / ändern* (Karten mit Tasks stehen oben), Badge mit dem Epic-Namen, Link zum Epic auf der Rückseite, Epic entfernen.
- **Hierarchie:** Beliebig tief möglich (Epic in einem Epic). Endlosschleifen werden verhindert. Der Fortschritt zählt die direkten Tasks.
- **Erledigt** ist eine Task, wenn sie in einer *Done-Liste* liegt, als „fällig erledigt“ markiert oder archiviert ist. Ohne Einstellung gelten Listen mit „Done / Erledigt / Fertig / Abgeschlossen / Complete“ im Namen als Done-Listen. Eigene Auswahl: Board-Menü → Power-Ups → Epic Tasks → Einstellungen.

## Einrichten

1. **Repo anlegen und pushen**
   ```bash
   git remote add origin git@github.com:<DEIN-USER>/trello-epic-tasks.git
   git push -u origin main
   ```
   (oder mit GitHub CLI: `gh repo create trello-epic-tasks --public --source=. --push`)
2. **GitHub Pages aktivieren:** Repo → *Settings → Pages → Deploy from a branch → `main` / `(root)`*. Die Seite liegt danach unter `https://<DEIN-USER>.github.io/trello-epic-tasks/`.
3. **Power-Up anlegen:** <https://trello.com/power-ups/admin> → *Neu*
   - Workspace: dein Workspace (du musst Admin sein)
   - **Iframe connector URL:** `https://<DEIN-USER>.github.io/trello-epic-tasks/`
   - Icon: `https://<DEIN-USER>.github.io/trello-epic-tasks/img/icon-epic.svg`
   - Tab *Capabilities*, aktivieren:
     `card-buttons`, `card-badges`, `card-detail-badges`, `card-back-section`, `show-settings`
4. **Zum Board hinzufügen:** Board → *Power-Ups* → *Benutzerdefiniert* → *Epic Tasks* → Hinzufügen.

## Lokal testen

```bash
npm test
```

Die Tests prüfen die Logik (`js/relations.js`) mit einem simulierten Trello-`t`-Objekt. Das Zusammenspiel mit dem echten Trello ist damit nicht abgedeckt.

## Grenzen

- **Nur ein Board.** Karten anderer Boards sind für `t.get`/`t.set` nicht erreichbar.
- **Bestehende Karten verknüpfen.** Ohne REST-API kann ein Power-Up keine neuen Karten anlegen.
- **Archiviert/gelöscht:** Was `t.cards()` nicht mehr liefert, fällt aus der Zählung. Für Erledigtes daher besser eine Done-Liste nutzen. Verwaiste Verknüpfungen lassen sich im Abschnitt auf der Rückseite mit *Bereinigen* entfernen.
- **Größe:** Trello erlaubt pro Karte und Scope ca. 4 KB Plugin-Daten. Das reicht für grob 130 Tasks pro Epic.
- **Gleichzeitige Änderungen:** Schreiben zwei Personen gleichzeitig am selben Epic, gewinnt der letzte Schreibvorgang.
- **Kopierte Karten** übernehmen keine Verknüpfung (Kopie-Erkennung).
- Der Fortschritt in Badges aktualisiert sich alle ~30 Sekunden, der Abschnitt auf der Rückseite alle ~20 Sekunden.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html`, `js/client.js` | Connector, registriert Buttons, Badges, Rückseiten-Abschnitt, Einstellungen |
| `js/relations.js` | Logik: Speichern, Zyklen-Check, Fortschritt, Suche (ohne UI, getestet) |
| `section.html`, `js/section.js` | Fortschritt und Task-Liste auf der Kartenrückseite |
| `settings.html`, `js/settings.js` | Auswahl der Done-Listen |
| `test/relations.test.js` | Unit-Tests |

## Lizenz

MIT, siehe [LICENSE](LICENSE). Bitte den Namen in der Lizenz anpassen.

# NoteLens

**Optical music recognition for sheet music, in pure JavaScript.**

Load a photo or scan of a staff, and Staffscan finds the staves, reads the notes, durations, dots and barlines, lets you fix mistakes by hand, plays the result back, and exports it as MusicXML or MIDI. It runs entirely in the browser as a single HTML file. There is no server, no build step to use it, and no dependencies.

## Features

- **Staff detection that copes with real photos.** It handles tilted and curved pages by tracking each staff line column by column, then flattening every staff into a straight strip before reading it.
- **Note reading.** Noteheads (filled and hollow), stems, flags and beams, augmentation dots, ledger lines and barlines. Chords are grouped by stem.
- **Clefs.** Treble, bass, alto (C clef) and tenor (C clef). The clef can be set for the whole page or per staff.
- **Key and time signature.** Set manually. They drive note names, measure grouping and the exports.
- **Manual correction.** Every detected note can be moved, deleted or added. Uncertain notes are flagged.
- **Playback** with the Web Audio API, at an adjustable tempo.
- **Export** to MusicXML, to MIDI, and to a plain list of note names.

## Quick start

Open `Staffscan.html` in any modern browser, or serve the folder with any static file server. Then:

1. Load an image of a staff (photo or scan).
2. Choose the clef, key, time signature and tempo.
3. Check the overlay, correct any wrong notes, and press play.
4. Export from the Export section.

For best results, use a sharp, well-lit image where the staff is at least about 600 px wide, and crop out text and other graphics when you can.


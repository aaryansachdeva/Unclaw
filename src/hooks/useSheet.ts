// Ambient widget sheets. App.tsx owns the active-sheet state directly (opening
// one closes the others); only the key union is shared from here.
export type SheetKey = 'reminders' | 'stocks' | 'news' | 'weather' | 'wardrobe';

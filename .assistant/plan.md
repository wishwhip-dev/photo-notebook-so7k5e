# Plan

Goal: A photo notebook. I open my camera and take a photo, or choose a photo from my device, add a short caption, and it is saved to a grid that survives a reload. Tap a photo to see it larger and to delete it.

1. The home page shows a photo notebook with two visible, labelled buttons on the page itself: 'Take photo' (opens the camera) and 'Add photos' (opens the file chooser); the grid area renders directly at the page URL with no sign-in or navigation.
2. Clicking 'Take photo' opens the camera from a user gesture: a live preview appears in the page and a capture button takes a photo; the camera stays open after a capture so several photos can be taken in a row before it is closed, and if the camera is refused or unavailable a text message saying so is shown instead of the preview.
3. Clicking 'Add photos' opens the file chooser with multiple selection: choosing three image files queues all three at once; photos can also be dropped or pasted onto the drop zone; any non-image file is rejected with a visible message naming the file, and an oversized photo is shrunk before it is queued.
4. Each queued photo shows its thumbnail with its own caption field and a 'Save' button inside a labelled form; the caption is optional — saving with it empty still adds the photo, shown in the grid without caption text — and a Cancel control discards that queued photo without saving it.
5. Saving writes each photo (resized image data, caption if any, and capture or file timestamp) to the Dexie database through the app's own data module, and reloading the page shows the saved photos and captions still in the grid.
6. The grid shows square-cropped thumbnails with their captions underneath, newest first, laid out as 2 columns on a phone-sized screen widening to 4 or more columns on a desktop window, with the total photo count shown above the grid; with no photos it shows a short empty-state message instead of a blank area.
7. Tapping or clicking a photo opens a dialog showing it enlarged with its full caption and the date it was taken, plus a 'Delete photo' button; pressing Delete removes it from the grid immediately and closing the dialog without deleting keeps the photo.
8. After deleting a photo and reloading the page, the photo is still gone; a photo queued but not yet saved is not persisted, so reloading mid-caption discards it.
9. Delete and the dialog work from the keyboard: the photo grid is focusable and Enter opens the large view, Escape closes the dialog, and Delete is reachable by Tab and activated by Enter.
10. Saving a photo shows a success toast and deleting shows a confirmation toast; a failure to save (for example storage refused) shows an error toast or an on-page message rather than silently doing nothing, and the photo stays queued so it can be retried.

These are the outcomes this task is judged against.
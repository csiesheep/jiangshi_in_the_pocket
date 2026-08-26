// The credits page's only script, and it exists for one control (#78): the
// language switch now lives in the top banner on every page, and this page had
// no script at all.
//
// SAY WHAT IT DOES AND DOES NOT DO. This page is not translated — there is no
// Chinese credits text and none was asked for — so pressing the switch here
// changes the PREFERENCE and stamps the document, and the words on this page
// stay as they are. That is a real effect rather than a dead control: every
// other page reads the same preference, so the choice made here is the language
// the rest of the site arrives in. It is still the weakest placement of the
// five, and worth revisiting if the credits are ever translated.

import * as L from "./lang.js";
import { mountLangSwitch, paintLangSwitch } from "./langswitch.js";
import { wireSleep } from "./shell.js";

function apply(lang) {
  L.remember(lang);
  L.stampDocument(lang);
  paintLangSwitch(lang);
}

const lang = L.preferred();
L.stampDocument(lang);
mountLangSwitch({ current: lang, onPick: apply });
wireSleep();

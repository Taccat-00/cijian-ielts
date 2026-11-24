import { escapeHTML as e } from '../utils/html.js';
import { motion } from '../motion.js';

// Dialog lifecycle is separate from the contents and the learning state.
export function createModal({ root, onOpen, onClose }) {
  let active;
  function close(restore = true, animated = false) {
    if (!active) return;
    const { dialog, trigger, action, id } = active;
    const finish = () => {
      if (!dialog.isConnected) return;
      onClose?.(dialog);
      dialog.close();
      dialog.remove();
      if (active?.dialog === dialog) active = null;
      if (restore && !root.querySelector('dialog[open]')) {
        const target = trigger?.isConnected ? trigger : [...document.querySelectorAll('[data-action]')].find(button => id && button.dataset.id === id && button.dataset.action === action) || document.querySelector('#word-search');
        target?.focus({ preventScroll:true });
      }
    };
    if (animated && !dialog.classList.contains('is-closing')) motion.closeDialog(dialog, finish);
    else if (!animated) finish();
  }
  function open(html, className = '') {
    close(false);
    const trigger = document.activeElement;
    root.innerHTML = `<dialog class="modal ${e(className)}" aria-labelledby="dialog-title">${html}<div class="dialog-toast" role="status" aria-live="polite"></div></dialog>`;
    const dialog = root.querySelector('dialog');
    active = { dialog, trigger, action:trigger?.dataset?.action, id:trigger?.dataset?.id };
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(true, true); });
    dialog.addEventListener('close', () => { if (dialog.isConnected) close(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(true, true);
    });
    dialog.showModal();
    motion.openDialog(dialog);
    onOpen?.();
  }
  return { open, close };
}

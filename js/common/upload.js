export function bindFilePreview(inputId, previewContainerId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewContainerId);
  if (!input || !preview) return;

  input.addEventListener('change', () => {
    preview.innerHTML = '';
    const file = input.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      preview.textContent = 'File exceeds 5 MB limit.';
      input.value = '';
      return;
    }

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const img = document.createElement('img');
        img.src = reader.result;
        img.style.maxWidth = '160px';
        img.style.maxHeight = '120px';
        img.style.borderRadius = '10px';
        img.style.border = '1px solid #E5E7EB';
        preview.appendChild(img);
      };
      reader.readAsDataURL(file);
    } else {
      const span = document.createElement('span');
      span.className = 'badge badge-info';
      span.textContent = `Selected: ${file.name}`;
      preview.appendChild(span);
    }
  });
}

// 內容後台（Sveltia CMS）自訂的內文編輯器按鈕
// 文件：https://sveltiacms.app/en/docs/api/editor-components
//
// 「插入下載檔案」：選擇或上傳檔案、輸入顯示文字，在內文插入下載連結
//   內文裡存成 <a href="/files/xxx.pdf" data-download-link target="_blank" rel="noopener">顯示文字</a>
//   網站以 .prose-story a[data-download-link] 樣式顯示（src/styles/global.css）
//   ⚠️ 修改 toBlock 的輸出格式時，pattern 也要一起改，否則後台讀不回已插入的連結

(function () {
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const unescapeHtml = (s) => String(s).replace(/&(amp|lt|gt|quot);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"' })[e]);
  const fileName = (path) => decodeURI(String(path || '').split('/').pop() || '');

  const toHtml = ({ file, text }) => {
    if (!file) return '';
    const label = String(text || '').trim() || fileName(file);
    return `<a href="${encodeURI(decodeURI(file))}" data-download-link target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
  };

  const register = () =>
    window.CMS.registerEditorComponent({
      id: 'download-file',
      label: '插入下載檔案',
      icon: 'download',
      trigger: 'button',
      fields: [
        {
          name: 'file',
          label: '檔案（PDF、Word、Excel 等；檔名建議用英文與數字）',
          widget: 'file',
          // 與課程「最新課表」相同：檔案存放在 public/files/，網址為 /files/檔名
          media_folder: '/public/files',
          public_folder: '/files',
        },
        { name: 'text', label: '顯示文字（家長點這段文字下載，例如：11602學期 上課注意事項）', widget: 'string', required: false },
      ],
      pattern: /<a href="([^"]+?)" data-download-link[^>]*>([^<\n]*?)<\/a>/,
      fromBlock: (match) => ({ file: decodeURI(match[1]), text: unescapeHtml(match[2]) }),
      toBlock: toHtml,
      toPreview: toHtml,
    });

  // Sveltia 載入後才有 window.CMS
  if (window.CMS) register();
  else window.addEventListener('load', register);
})();

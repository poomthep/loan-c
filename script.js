/**
 * @file script.js
 * @description All application logic for the Home Loan Analysis Tool.
 * This script handles user authentication, data management with Supabase,
 * loan calculations, and dynamic UI updates.
 */

// ===== CONFIG & STATE =====
const SUPABASE_URL = 'https://crgyqlfotaceyvoxatnq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNyZ3lxbGZvdGFjZXl2b3hhdG5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY5ODg5NzAsImV4cCI6MjA3MjU2NDk3MH0.pvSRkwkkCQNyRuG-cFadLTQjL6Cf73d4Nu7ur3YSn2U';
const USE_SUPABASE = true;

let supabaseClient = null;
let currentUser = null;
let isAdmin = false;

// In-memory data stores
let allBanks = [];
let promoByBank = {};
let promosById = {};
let selectedPromoIds = new Set();

// ===== เพิ่ม 2 บรรทัดนี้ =====
let promoAdminOriginalParent = null;
let bankAdminOriginalParent = null;
// ==========================

// ===== UTILITY FUNCTIONS =====

/**
 * Formats a number to a Thai locale string.
 * @param {number} n The number to format.
 * @returns {string} The formatted number string.
 */
const fmt = (n) => new Intl.NumberFormat('th-TH').format(Math.round(n || 0));

/**
 * Toggles the visibility of a card's content.
 * @param {HTMLElement} headerElement The card header element that was clicked.
 */
function toggleCard(headerElement) {
  headerElement.classList.toggle('active');
  const content = headerElement.nextElementSibling;
  if (content && content.classList.contains('card-content')) {
    content.classList.toggle('collapsed');
  }
}

/**
 * Formats a number input to include commas.
 * @param {HTMLInputElement} el The input element.
 */
function formatNumberInput(el) {
  let value = (el.value || '').replace(/,/g, '');
  if (value === '' || isNaN(value)) {
    el.value = '';
    return;
  }
  el.value = parseFloat(value).toLocaleString('en-US');
}

/**
 * Gets a clean numeric value from an input field.
 * @param {string} id The ID of the input element.
 * @returns {number} The parsed numeric value, or 0 if empty/invalid.
 */
function getNumericValue(id) {
  const el = document.getElementById(id);
  if (!el || el.value === '') return 0;
  return parseFloat(el.value.replace(/,/g, '')) || 0;
}

/**
 * Shows the global loading spinner.
 * @param {string} [text='กำลังทำงาน...'] The text to display below the spinner.
 */
function showSpinner(text = 'กำลังทำงาน...') {
  const overlay = document.getElementById('globalSpinner');
  if (overlay) {
    overlay.style.display = 'flex';
    const label = overlay.querySelector('.spinner-label');
    if (label) label.textContent = text;
  }
}

/** Hides the global loading spinner. */
function hideSpinner() {
  const overlay = document.getElementById('globalSpinner');
  if (overlay) overlay.style.display = 'none';
}

/**
 * Displays a toast notification.
 * @param {string} message The message to display.
 * @param {'info'|'success'|'error'} [type='info'] The type of toast.
 */
function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    el.classList.add('hide');
  }, 2500);
  setTimeout(() => el.remove(), 3000);
}


// ===== MODAL & UI HELPERS =====

/** Ensures the modal host element exists and returns it. */
function ensureModalHost() {
  return document.getElementById('modalHost');
}

/** Closes any active modal. */
function closeModal() {
  const host = ensureModalHost();
  const promoAdminPanel = host.querySelector('#promoAdmin');
  const bankAdminPanel = host.querySelector('#bankAdmin');
  const actionButtons = host.querySelector('#promoActionButtons');

  // ย้าย promo panel กลับไปที่เดิม (ถ้ามี)
  if (promoAdminPanel && promoAdminOriginalParent) {
    // ก่อนย้าย panel กลับ, เอากลุ่มปุ่มกลับเข้าไปใน panel ก่อน
    if(actionButtons) {
        // หา .card-content เพื่อเอากลุ่มปุ่มไปต่อท้าย
        const cardContent = promoAdminPanel.querySelector('.card-content');
        if (cardContent) {
            cardContent.appendChild(actionButtons);
        }
    }
    promoAdminPanel.style.display = 'none'; // ซ่อน panel ก่อนย้ายกลับ
    promoAdminOriginalParent.appendChild(promoAdminPanel);
  }

  // ย้าย bank panel กลับไปที่เดิม (ถ้ามี)
  if (bankAdminPanel && bankAdminOriginalParent) {
    bankAdminPanel.style.display = 'none'; // ซ่อน panel ก่อนย้ายกลับ
    bankAdminOriginalParent.appendChild(bankAdminPanel);
  }

  host.style.display = 'none';
  host.innerHTML = ''; // ล้างเนื้อหา modal
}

/**
 * Renders a list of interest rates into an HTML string.
 * @param {Array<object>} rates The array of rate objects.
 * @returns {string} HTML string representing the list.
 */
function renderRatesList(rates = []) {
  if (!rates.length) return '<div style="font-size:12px;color:#888;">ไม่พบโครงสร้างดอกเบี้ย</div>';
  return rates.map(r => `
    <div class='rate-year' style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f0f0f0">
      <span style="font-size:12px;">ปีที่ ${r.year === 99 ? 'ถัดไป' : r.year}</span>
      <div class="rate-details" style="display:flex;gap:6px;align-items:baseline">
        <span style="font-weight:700">${Number(r.rate).toFixed(2)}%</span>
        <span class="rate-description" style="color:#6c757d;font-size:11px">${r.description || ''}</span>
      </div>
    </div>`).join('');
}

/**
 * Opens the Bank Admin panel in a modal window.
 */
function openBankAdminModal() {
  const host = ensureModalHost();
  const bankAdminContent = document.getElementById('bankAdmin')?.innerHTML;
  if (!bankAdminContent) {
    toast('ไม่พบส่วนจัดการธนาคาร', 'error');
    return;
  }

  host.innerHTML = `
    <div role="dialog" aria-modal="true" style="width: 95%; max-width: 800px; background: #fff; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.3);">
      <div style="display:flex; justify-content:space-between; align-items:center; padding: 12px 16px; border-bottom: 1px solid #e9ecef;">
        <h2 style="font-size: 1.1rem; margin:0;">🏦 จัดการข้อมูลธนาคารและ MRR</h2>
        <button class="btn btn-danger" style="padding: 8px 12px;" onclick="closeModal()">ปิด</button>
      </div>
      <div style="padding: 16px; max-height: 75vh; overflow-y: auto;">
        ${bankAdminContent}
      </div>
    </div>
  `;
  // Make the content visible inside the modal
  const modalContent = host.querySelector('.card-content');
  if(modalContent) modalContent.classList.remove('collapsed');

  host.style.display = 'flex';
}

/**
 * Opens the Promotion Admin panel in a modal window.
 */
function openPromoAdminModal() {
  const host = ensureModalHost();
  const promoAdminPanel = document.getElementById('promoAdmin');
  if (!promoAdminPanel) {
    toast('ไม่พบส่วนจัดการโปรโมชัน', 'error');
    return;
  }

  if (!promoAdminOriginalParent) {
    promoAdminOriginalParent = promoAdminPanel.parentElement;
  }

  const modalContentHTML = `
    <div role="dialog" aria-modal="true" style="width: 95%; max-width: 800px; background: #fff; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.3); display: flex; flex-direction: column; max-height: 90vh;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding: 12px 16px; border-bottom: 1px solid #e9ecef;">
        <h2 style="font-size: 1.1rem; margin:0;">🛠️ เพิ่ม/แก้ไข โปรธนาคาร</h2>
        <button class="btn btn-danger" style="padding: 8px 12px;" onclick="closeModal()">ปิด</button>
      </div>
      <div id="promoModalBody" class="modal-body-scrollable" style="padding: 16px; overflow-y: auto; flex-grow: 1;">
        </div>
      <div id="promoModalFooter" class="modal-sticky-footer">
        </div>
    </div>
  `;
  host.innerHTML = modalContentHTML;

  const modalBody = host.querySelector('#promoModalBody');
  if (modalBody) {
    modalBody.appendChild(promoAdminPanel);
  }
  
  const modalFooter = host.querySelector('#promoModalFooter');
  const actionButtons = document.getElementById('promoActionButtons');
  if (modalFooter && actionButtons) {
    modalFooter.appendChild(actionButtons);
  }

  promoAdminPanel.style.display = 'block';
  const content = promoAdminPanel.querySelector('.card-content');
  if (content) content.classList.remove('collapsed');

  host.style.display = 'flex';
}

/**
 * Opens the Bank Admin panel in a modal window.
 */
function openBankAdminModal() {
  const host = ensureModalHost();
  const bankAdminPanel = document.getElementById('bankAdmin');
  if (!bankAdminPanel) {
    toast('ไม่พบส่วนจัดการธนาคาร', 'error');
    return;
  }

  if (!bankAdminOriginalParent) {
    bankAdminOriginalParent = bankAdminPanel.parentElement;
  }

  const modalContentHTML = `
    <div role="dialog" aria-modal="true" style="width: 95%; max-width: 800px; background: #fff; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.3);">
      <div style="display:flex; justify-content:space-between; align-items:center; padding: 12px 16px; border-bottom: 1px solid #e9ecef;">
        <h2 style="font-size: 1.1rem; margin:0;">🏦 จัดการข้อมูลธนาคารและ MRR</h2>
        <button class="btn btn-danger" style="padding: 8px 12px;" onclick="closeModal()">ปิด</button>
      </div>
       <div id="bankModalBody" class="modal-body-scrollable" style="padding: 16px; max-height: 75vh; overflow-y: auto;">
        </div>
    </div>
  `;
  host.innerHTML = modalContentHTML;

  const modalBody = host.querySelector('#bankModalBody');
  if (modalBody) {
    modalBody.appendChild(bankAdminPanel);
  }
  
  bankAdminPanel.style.display = 'block';
  const content = bankAdminPanel.querySelector('.card-content');
  if (content) content.classList.remove('collapsed');
  
  host.style.display = 'flex';
}

/**
 * Opens the Bank Admin panel in a modal window.
 */
function openBankAdminModal() {
  const host = ensureModalHost();
  const bankAdminPanel = document.getElementById('bankAdmin');
  if (!bankAdminPanel) {
    toast('ไม่พบส่วนจัดการธนาคาร', 'error');
    return;
  }

  // บันทึกตำแหน่งเดิมของ panel
  if (!bankAdminOriginalParent) {
    bankAdminOriginalParent = bankAdminPanel.parentElement;
  }

  const modalContentHTML = `
    <div role="dialog" aria-modal="true" style="width: 95%; max-width: 800px; background: #fff; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.3);">
      <div style="display:flex; justify-content:space-between; align-items:center; padding: 12px 16px; border-bottom: 1px solid #e9ecef;">
        <h2 style="font-size: 1.1rem; margin:0;">🏦 จัดการข้อมูลธนาคารและ MRR</h2>
        <button class="btn btn-danger" style="padding: 8px 12px;" onclick="closeModal()">ปิด</button>
      </div>
      <div id="bankModalBody" style="padding: 16px; max-height: 75vh; overflow-y: auto;">
        </div>
    </div>
  `;
  host.innerHTML = modalContentHTML;

  // ย้าย panel เข้ามาใน modal body
  const modalBody = host.querySelector('#bankModalBody');
  if (modalBody) {
    modalBody.appendChild(bankAdminPanel);
  }
  
  // ทำให้ panel และเนื้อหาแสดงผล
  bankAdminPanel.style.display = 'block';
  const content = bankAdminPanel.querySelector('.card-content');
  if (content) content.classList.remove('collapsed');
  
  host.style.display = 'flex';
}

// ===== SUPABASE & AUTHENTICATION =====

/** Initializes the Supabase client if it doesn't exist. */
function initSupabase() {
  try {
    if (USE_SUPABASE && !supabaseClient && window.supabase) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  } catch (e) {
    console.error('Supabase init error', e);
  }
}

/** Handles user login. */
async function login() {
  if (!supabaseClient) {
    initSupabase();
    if (!supabaseClient) {
      showLoginError('ยังโหลดไลบรารีไม่เสร็จ');
      return;
    }
  }
  const email = (document.getElementById('email').value || '').trim();
  const password = document.getElementById('password').value || '';
  if (!email || !password) {
    showLoginError('กรอกอีเมลและรหัสผ่าน');
    return;
  }
  try {
    showSpinner('กำลังเข้าสู่ระบบ...');
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    await determineAdmin();
    updateAuthUI(true);
    await refreshPromos();
    toast('เข้าสู่ระบบสำเร็จ', 'success');
  } catch (e) {
    toast('เข้าสู่ระบบไม่สำเร็จ', 'error');
    const errorMessage = e?.message === 'Invalid login credentials' ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : `เกิดข้อผิดพลาด: ${e?.message || e}`;
    showLoginError(errorMessage);
  } finally {
    hideSpinner();
  }
}

/** Handles user logout. */
async function logout() {
  try {
    if (supabaseClient) await supabaseClient.auth.signOut();
  } catch (e) {
    console.error('Logout error:', e);
  }
  currentUser = null;
  isAdmin = false;
  promoByBank = {};
  promosById = {};
  allBanks = [];
  selectedPromoIds = new Set();
  updateCompareBar();
  updateAuthUI(false);
  const cmp = document.getElementById('bankComparison');
  if (cmp) cmp.innerHTML = '';
}

/**
 * Displays a login error message.
 * @param {string} msg The error message to show.
 */
function showLoginError(msg) {
  const el = document.getElementById('loginError');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

/**
 * Updates the UI based on login status.
 * @param {boolean} loggedIn Is the user logged in?
 */
function updateAuthUI(loggedIn) {
  const mainContent = document.getElementById('mainContent');
  const authCard = document.getElementById('auth-card');
  const leftCol = document.getElementById('left-column');
  const adminButtons = document.querySelectorAll('.admin-btn');

  // การ์ด/แพเนลฝั่งขวาที่ต้องซ่อนเมื่อยังไม่ล็อกอิน
  const rightPanels = [
    'actionButtonsCard',
    'analysisResultCard',
    'comparisonResultCard',
    'amortizationResultCard',
    'bankAdmin',
    'promoAdmin'
  ];

  // ให้ main แสดงเสมอเพื่อให้เห็นการ์ดล็อกอิน
  if (mainContent) mainContent.style.display = 'block';

  if (loggedIn && currentUser) {
    // ซ่อนการ์ดล็อกอิน → โชว์ทุกอย่างที่ต้องใช้
    if (authCard) authCard.style.display = 'none';

    if (leftCol) leftCol.style.display = ''; // ให้เห็นข้อมูลผู้กู้ทางซ้าย
    rightPanels.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      // โชว์เฉพาะ "เครื่องมือและผลลัพธ์" เป็นค่าเริ่ม
      el.style.display = (id === 'actionButtonsCard') ? 'block' : 'none';
    });

    adminButtons.forEach(btn => { btn.style.display = isAdmin ? 'flex' : 'none'; });
  } else {
    // ยังไม่ล็อกอิน: ซ่อนการ์ดข้อมูลผู้กู้ + ซ่อนการ์ดผลลัพธ์ทั้งหมด และโชว์การ์ดล็อกอิน
    if (leftCol) leftCol.style.display = 'none';
    rightPanels.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    adminButtons.forEach(btn => { btn.style.display = 'none'; });

    if (authCard) {
      authCard.style.display = 'block';
      // โฟกัสช่องอีเมล + เลื่อนให้การ์ดอยู่กลางจอ
      setTimeout(() => {
        const email = document.getElementById('email');
        if (email) email.focus();
        authCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }

  // เคลียร์รหัสผ่านทุกครั้ง
  const pwd = document.getElementById('password');
  if (pwd) pwd.value = '';
}

/** Checks if the current user has an 'admin' role via Supabase RPC. */
async function determineAdmin() {
  if (!currentUser || !supabaseClient) {
    isAdmin = false;
    return;
  }
  try {
    const { data, error } = await supabaseClient.rpc('get_my_role');
    if (error) throw error;
    isAdmin = (data === 'admin');
  } catch (e) {
    console.warn('Role check failed', e);
    isAdmin = false;
  }
}


// ===== DATA MANAGEMENT: BANKS (ADMIN) =====

/** Fetches all banks from the database. */
async function fetchBanks() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('banks').select('id,bank_name,current_mrr').order('bank_name');
    if (error) throw error;
    allBanks = data || [];
    renderBankList();
    populateBankDropdown();
  } catch (e) {
    console.error('Fetch banks error:', e);
    toast('ไม่สามารถดึงข้อมูลธนาคารได้', 'error');
  }
}

/** Renders the list of banks in the admin panel. */
function renderBankList() {
  const container = document.getElementById('bankMasterList');
  if (!container) return;
  if (allBanks.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#666;font-size:12px;">ยังไม่มีข้อมูลธนาคาร</p>';
    return;
  }
  container.innerHTML = allBanks.map(b => `
    <div style="padding:8px;border-bottom:1px solid #e9ecef;display:flex;justify-content:space-between;gap:10px">
      <div style="flex:1"><strong style="font-size:13px">${b.bank_name}</strong><br><span style="color:#555;font-size:11px">MRR: ${b.current_mrr}%</span></div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-admin" onclick='editBank(${JSON.stringify(b)})'>แก้ไข</button>
        <button class="btn btn-danger btn-admin" onclick="deleteBank('${b.id}','${b.bank_name.replace(/"/g, '&quot;')}')">ลบ</button>
      </div>
    </div>`).join('');
}

/** Populates the bank selection dropdown in the promotion form. */
function populateBankDropdown() {
  const select = document.getElementById('promoBankName');
  if (!select) return;
  select.innerHTML = '<option value="">— เลือกธนาคาร —</option>' + allBanks.map(b => `<option value="${b.bank_name}">${b.bank_name}</option>`).join('');
  handleBankSelectionChange();
}

/** Saves or updates a bank's details. */
async function saveBank() {
  if (!isAdmin || !supabaseClient) return;
  const id = document.getElementById('bankIdInput').value;
  const bank_name = (document.getElementById('bankNameMasterInput').value || '').trim();
  const current_mrr = parseFloat(document.getElementById('bankMrrMasterInput').value);

  if (!bank_name || isNaN(current_mrr)) {
    alert('กรุณากรอกชื่อธนาคารและค่า MRR ให้ถูกต้อง');
    return;
  }

  try {
    if (id) { // Update existing bank
      const { error } = await supabaseClient.from('banks').update({ bank_name, current_mrr }).eq('id', id);
      if (error) throw error;
    } else { // Insert new bank
      const { error } = await supabaseClient.from('banks').insert({ bank_name, current_mrr });
      if (error) throw error;
    }
    toast('บันทึกข้อมูลธนาคารสำเร็จ', 'success');
    clearBankForm();
    await fetchBanks();
  } catch (e) {
    alert('เกิดข้อผิดพลาด: ' + e.message);
  }
}

/**
 * Populates the bank form for editing.
 * @param {object} bank The bank object.
 */
function editBank(bank) {
  document.getElementById('bankIdInput').value = bank.id;
  document.getElementById('bankNameMasterInput').value = bank.bank_name;
  document.getElementById('bankMrrMasterInput').value = bank.current_mrr;
  document.getElementById('bankAdmin').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Deletes a bank.
 * @param {string} id The bank ID.
 * @param {string} name The bank name.
 */
async function deleteBank(id, name) {
  if (!isAdmin || !supabaseClient || !confirm(`ยืนยันการลบ "${name}" ?`)) return;
  try {
    const { error } = await supabaseClient.from('banks').delete().eq('id', id);
    if (error) throw error;
    toast('ลบธนาคารสำเร็จ', 'success');
    await fetchBanks();
  } catch (e) {
    alert('ผิดพลาด: ' + e.message);
  }
}

/** Clears the bank admin form. */
function clearBankForm() {
  document.getElementById('bankIdInput').value = '';
  document.getElementById('bankNameMasterInput').value = '';
  document.getElementById('bankMrrMasterInput').value = '';
}


// ===== DATA MANAGEMENT: PROMOTIONS (ADMIN) =====

/** Fetches all promotions from the database. */
async function fetchPromotions() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('bank_promotions').select('*').order('bank_name');
    if (error) throw error;

    // Group promotions by bank name
    promoByBank = (data || []).reduce((acc, row) => {
      (acc[row.bank_name] = acc[row.bank_name] || []).push(row);
      return acc;
    }, {});

    // Create a lookup map for promotions by their ID for quick access
    promosById = {};
    (data || []).forEach(p => { if (p?.id) promosById[p.id] = p; });

    renderPromoList(); // Note: This function is not defined in the original file, assuming it's for a detailed admin list.
  } catch (e) {
    console.error('Fetch promotions error:', e);
    toast('ไม่สามารถดึงโปรโมชั่นได้', 'error');
  }
}

/**
 * Renders the list of all promotions in the admin panel.
 */
function renderPromoList() {
    const container = document.getElementById('myPromoList');
    if (!container) return;

    const allPromos = Object.values(promoByBank).flat();
    if (allPromos.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#666;font-size:12px;">ยังไม่มีโปรในฐานข้อมูล</p>';
        return;
    }

    // This part was missing. It generates the HTML for the admin promo list.
    container.innerHTML = allPromos.map(p => {
        const ratesText = (p.rates || []).map(r => `
            <div class='rate-year' style="display:flex; justify-content:space-between; font-size:11px; padding: 2px 0;">
                <span>ปีที่ ${r.year === 99 ? 'ถัดไป' : r.year}</span>
                <div class="rate-details">
                    <span style="font-weight:600;">${Number(r.rate).toFixed(2)}%</span>
                    <span style="color:#6c757d; margin-left:4px;">${r.description || ''}</span>
                </div>
            </div>`).join('');

        const endDate = p.promo_end_date ? new Date(p.promo_end_date).toLocaleDateString('th-TH') : 'ไม่มีกำหนด';

        return `
        <div class="promo-list-item" style="border: 1px solid #e9ecef; border-radius: 8px; padding: 10px; margin-bottom: 10px;">
          <div class="promo-list-header" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <div><strong>${p.bank_name}</strong> — ${p.name}</div>
            ${isAdmin ? `
            <div style="display:flex; gap:4px; flex-wrap:wrap;">
              <button class="btn btn-secondary btn-admin" onclick='editPromotion(${JSON.stringify(p)})'>แก้ไข</button>
              <button class="btn btn-danger btn-admin" onclick="deletePromotion('${p.id}')">ลบ</button>
            </div>` : ''}
          </div>
          <div class="promo-list-deadline" style="font-size:11px; color:#555; margin-top:4px;">ยื่นกู้ภายใน: ${endDate}</div>
          <div class="promo-list-rates" style="margin-top:8px;">${ratesText}</div>
        </div>`;
    }).join('');
}

/** Handles the change event for the bank selection dropdown. */
function handleBankSelectionChange() {
  const selectedBankName = document.getElementById('promoBankName')?.value || '';
  const mrrDisplay = document.getElementById('promoMrrDisplay');
  if (!mrrDisplay) return;

  if (selectedBankName) {
    const bank = allBanks.find(b => b.bank_name === selectedBankName);
    mrrDisplay.value = bank ? Number(bank.current_mrr).toFixed(2) : '';
  } else {
    mrrDisplay.value = '';
  }
}

/**
 * Adds a new row for a fixed-rate year to the promotion form.
 * @param {number} [year=0] The year number (e.g., 1, 2, 3). If 0, it's calculated automatically.
 * @param {string|number} [rate=''] The interest rate for that year.
 */
function addFixedRateYear(year = 0, rate = '') {
  const container = document.getElementById('fixedRatesContainer');
  if (!container) return;
  const nextYear = year > 0 ? year : container.getElementsByClassName('fixed-rate-row').length + 1;

  const row = document.createElement('div');
  row.className = 'fixed-rate-row';
  row.style.cssText = 'display:grid; grid-template-columns:1fr 1fr auto; gap:8px; align-items:center;';
  row.innerHTML = `
    <input type="text" class="fixed-rate-year-display" value="ปีที่ ${nextYear}" disabled>
    <input type="hidden" class="fixed-rate-year-input" value="${nextYear}">
    <input type="number" step="0.01" class="fixed-rate-rate-input" placeholder="อัตราดอกเบี้ย %" value="${rate}">
    <button type="button" class="btn btn-danger btn-admin" onclick="this.parentElement.remove()">ลบ</button>`;
  container.appendChild(row);
}

/**
 * Parses the interest rate structure from the promotion form inputs.
 * @returns {Array<object>} An array of rate objects.
 */
function parseRatesFromForm() {
  const rates = [];
  document.querySelectorAll('.fixed-rate-row').forEach(row => {
    const year = parseInt(row.querySelector('.fixed-rate-year-input').value, 10);
    const rate = parseFloat(row.querySelector('.fixed-rate-rate-input').value);
    if (!isNaN(year) && !isNaN(rate)) {
      rates.push({ year, rate, description: 'ดอกเบี้ยคงที่' });
    }
  });

  const bankMrr = parseFloat(document.getElementById('promoMrrDisplay').value);
  const mrrSubtract = parseFloat(document.getElementById('promoMrrSubtractInput').value);
  if (!isNaN(bankMrr) && !isNaN(mrrSubtract)) {
    rates.push({
      year: 99, // Special value for floating rate years
      rate: bankMrr - mrrSubtract,
      description: `MRR (${bankMrr.toFixed(2)}%) - ${mrrSubtract.toFixed(2)}%`
    });
  }
  return rates.sort((a, b) => a.year - b.year);
}

/**
 * Populates the promotion form with an existing rate structure for editing.
 * @param {Array<object>} rates The array of rate objects.
 */
function populateFormWithRates(rates) {
  clearPromoFormFields();
  (rates || []).forEach(rate => {
    if (rate.year === 99) { // Floating rate
      const match = (rate.description || '').match(/MRR\s*\((\d+\.?\d*)\%\)\s*-\s*(\d+\.?\d*)\%/);
      if (match && match.length === 3) {
        document.getElementById('promoMrrDisplay').value = match[1];
        document.getElementById('promoMrrSubtractInput').value = match[2];
      }
    } else { // Fixed rate
      addFixedRateYear(rate.year, rate.rate);
    }
  });
}

/** Clears only the rate-related fields in the promo form. */
function clearPromoFormFields() {
    document.getElementById('fixedRatesContainer').innerHTML = '';
    document.getElementById('promoMrrDisplay').value = '';
    document.getElementById('promoMrrSubtractInput').value = '';
}

/** Clears all fields in the promotion admin form. */
function clearPromoForm() {
  document.getElementById('promoIdInput').value = '';
  document.getElementById('promoBankName').value = '';
  document.getElementById('promoName').value = '';
  document.getElementById('promoStartDate').value = '';
  document.getElementById('promoEndDate').value = '';
  document.getElementById('contractEndDate').value = '';
  document.getElementById('maxLoanAmountThb').value = '';
  document.getElementById('promoMaxLTV').value = '';
  document.getElementById('promoMaxLoanAge').value = '';
  clearPromoFormFields();
}

/** Saves or updates a promotion. */
async function savePromotion() {
  if (!isAdmin || !supabaseClient) return;

  const id = (document.getElementById('promoIdInput').value || '').trim();
  const bank_name = document.getElementById('promoBankName').value || '';
  const name = (document.getElementById('promoName').value || '').trim();
  const rates = parseRatesFromForm();

  if (!bank_name || !name || rates.length === 0) {
    alert('กรุณากรอกชื่อธนาคาร/โปร และอัตราดอกเบี้ยอย่างน้อย 1 รายการ');
    return;
  }

  const promoData = {
    bank_name,
    name,
    rates,
    promo_start_date: document.getElementById('promoStartDate').value || null,
    promo_end_date: document.getElementById('promoEndDate').value || null,
    contract_end_date: document.getElementById('contractEndDate').value || null,
    max_loan_amount_thb: getNumericValue('maxLoanAmountThb') || null,
    max_loan_ltv: parseInt(document.getElementById('promoMaxLTV').value, 10) || 100,
    max_loan_age: parseInt(document.getElementById('promoMaxLoanAge').value, 10) || 65,
	dsr_ceiling: parseInt(document.getElementById('promoDsrCeiling').value, 10) || 55,
	income_rules: {
		salary: parseInt(document.getElementById('incomeSalaryPercent').value, 10) || 100,
		bonus: parseInt(document.getElementById('incomeBonusPercent').value, 10) || 50,
		ot: parseInt(document.getElementById('incomeOtPercent').value, 10) || 50,
		commission: parseInt(document.getElementById('incomeCommissionPercent').value, 10) || 50,
		other: parseInt(document.getElementById('incomeOtherPercent').value, 10) || 50,
	},
    loan_calc_method: document.getElementById('promoCalcMethod')?.value || 'accurate',
    multiplier: parseInt(document.getElementById('promoMultiplier')?.value, 10) || 150,
    per_million_rate: getNumericValue('promoPerMillionRate') || 7000,
    // ===== เพิ่มบรรทัดนี้เพื่อบันทึกค่าใหม่ =====
    income_acceptance_ratio: parseInt(document.getElementById('promoIncomeAcceptanceRatio')?.value, 10) || 100,
  };

  try {
    if (id) { // Update
      const { error } = await supabaseClient.from('bank_promotions').update(promoData).eq('id', id);
      if (error) throw error;
    } else { // Insert
      const { error } = await supabaseClient.from('bank_promotions').insert([promoData]);
      if (error) throw error;
    }
    toast('บันทึกโปรโมชั่นสำเร็จ', 'success');
    clearPromoForm();
    await fetchPromotions();
  } catch (e) {
    alert('เกิดข้อผิดพลาด: ' + e.message);
  }
}

/**
 * Populates the promotion form for editing.
 * @param {object} promo The promotion object.
 */
function editPromotion(promo) {
    document.getElementById('promoIdInput').value = promo.id || '';
    document.getElementById('promoBankName').value = promo.bank_name || '';
    document.getElementById('promoName').value = promo.name || '';
    document.getElementById('promoStartDate').value = promo.promo_start_date ? promo.promo_start_date.split('T')[0] : '';
    document.getElementById('promoEndDate').value = promo.promo_end_date ? promo.promo_end_date.split('T')[0] : '';
    document.getElementById('contractEndDate').value = promo.contract_end_date ? promo.contract_end_date.split('T')[0] : '';
    document.getElementById('maxLoanAmountThb').value = promo.max_loan_amount_thb ? fmt(promo.max_loan_amount_thb) : '';
    document.getElementById('promoMaxLTV').value = promo.max_loan_ltv || '';
    document.getElementById('promoMaxLoanAge').value = promo.max_loan_age || '';
    populateFormWithRates(promo.rates || []);
    document.getElementById('promoAdmin').scrollIntoView({ behavior: 'smooth' });
}


/**
 * Deletes a promotion.
 * @param {string} id The promotion ID.
 */
async function deletePromotion(id) {
  if (!isAdmin || !id || !supabaseClient || !confirm('ยืนยันการลบโปรโมชั่นนี้?')) return;
  try {
    const { error } = await supabaseClient.from('bank_promotions').delete().eq('id', id);
    if (error) throw error;
    await fetchPromotions();
    toast('ลบโปรโมชั่นเรียบร้อย', 'success');
  } catch (e) {
    alert('ผิดพลาด: ' + e.message);
  }
}


// ===== FINANCIAL CALCULATOR =====

/**
 * Calculates the monthly mortgage payment.
 * @param {number} P Principal loan amount.
 * @param {number} annualRate Annual interest rate (in %).
 * @param {number} years Loan term in years.
 * @returns {number} The monthly payment amount.
 */
function calcMonthly(P, annualRate, years) {
  const r = (annualRate / 100) / 12; // Monthly interest rate
  const n = years * 12; // Total number of payments
  if (n <= 0) return 0;
  if (r === 0) return P / n;
  return P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

/**
 * Calculates the maximum loan amount one can afford.
 * @param {number} monthlyPayment The affordable monthly payment.
 * @param {number} annualRate Annual interest rate (in %).
 * @param {number} years Loan term in years.
 * @returns {number} The maximum loan amount.
 */
function calculateMaxLoan(monthlyPayment, annualRate, years) {
  const r = (annualRate / 100) / 12;
  const n = years * 12;
  if (n <= 0) return 0;
  if (r === 0) return monthlyPayment * n;
  return monthlyPayment * ((Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n)));
}

/**
 * Calculates monthly payment based on a tiered interest rate structure.
 * It computes an average rate over the entire term for the calculation.
 * @param {number} P Principal loan amount.
 * @param {Array<object>} rates Tiered interest rates.
 * @param {number} years Loan term in years.
 * @returns {{monthly: number}} An object containing the calculated monthly payment.
 */
function calcTiered(P, rates, years) {
  if (!rates || !rates.length) {
    // Fallback to a default rate if none are provided
    return { monthly: calcMonthly(P, 3.5, years) };
  }
  
  let coveredYears = 0;
  let rateSum = 0;
  
  for (const tier of rates) {
    const yearsInTier = tier.year === 99 
      ? Math.max(0, years - coveredYears)
      : Math.min(tier.year - coveredYears, Math.max(0, years - coveredYears));
      
    if (yearsInTier <= 0) continue;
    
    rateSum += tier.rate * yearsInTier;
    coveredYears += yearsInTier;
    
    if (coveredYears >= years) break;
  }
  
  const averageRate = rateSum / (years || 1);
  return { monthly: calcMonthly(P, averageRate, years) };
}

/**
 * ฟังก์ชันสำหรับคำนวณวงเงินกู้สูงสุด โดยพิจารณาจาก 2 เกณฑ์หลัก
 * 1. ความสามารถในการผ่อนชำระ (DSR)
 * 2. มูลค่าหลักประกัน (LTV)
 * และจะคืนค่าวงเงินที่ "ต่ำกว่า"
 *
 * @param {object} borrower ข้อมูลผู้กู้ (รายได้, หนี้สิน, ราคาบ้าน)
 * @param {object} promo ข้อมูลโปรโมชัน (LTV, อัตราดอกเบี้ย)
 * @returns {number} วงเงินกู้สูงสุดที่สามารถอนุมัติได้
 */
function calculateFinalLoanAmount(borrower, promo) {
  // --- ส่วนที่ 1: คำนวณจากความสามารถในการผ่อน (DSR) ---

  const DSR_CEILING_PERCENT = 55; // เพดานหนี้ 55% ของรายได้
  const MONTHLY_PAYMENT_PER_MILLION = 7000; // ยอดผ่อนล้านละ 7,000

  // สมมติว่ารายได้ที่ประเมินคือเงินเดือน 100%
  const assessableIncome = borrower.salary || 0;

  // คำนวณยอดที่สามารถผ่อนได้ต่อเดือน
  const maxAffordablePayment = (assessableIncome * (DSR_CEILING_PERCENT / 100)) - (borrower.debt || 0);

  // แปลงเป็นวงเงินกู้สูงสุดจากความสามารถในการผ่อน
  let maxLoanFromDSR = 0;
  if (maxAffordablePayment > 0) {
    maxLoanFromDSR = (maxAffordablePayment * 1000000) / MONTHLY_PAYMENT_PER_MILLION;
  }


  // --- ส่วนที่ 2: คำนวณจากมูลค่าหลักประกัน (LTV) ---

  const maxLtvPercent = promo.max_loan_ltv || 100; // ถ้าโปรโมชันไม่กำหนด ให้ LTV เป็น 100%
  const maxLoanFromLTV = (borrower.housePrice || 0) * (maxLtvPercent / 100);


  // --- ส่วนที่ 3: สรุปวงเงินสุดท้าย (เลือกค่าที่ต่ำที่สุด) ---

  const finalLoanAmount = Math.min(maxLoanFromDSR, maxLoanFromLTV, borrower.housePrice);

  // คืนค่าเป็นจำนวนเต็มและป้องกันค่าติดลบ
  return Math.max(0, Math.floor(finalLoanAmount));
}

/**
 * Runs an advanced analysis for a specific promotion and borrower.
 * @param {object} promo The promotion object from the database.
 * @param {object} borrower The borrower's financial information.
 * @returns {object} A detailed analysis result.
 */
function runAdvancedAnalysis(promo, borrower) {
  const DSR_CEILING = promo.dsr_ceiling || 55;
  const DEFAULT_MAX_AGE = 65;
  const MAX_LOAN_YEARS = 40;

  const analysis = {
    bankName: promo.bank_name,
    promoName: promo.name,
    maxTerm: 0,
    totalAssessableIncome: 0,
    maxLoanAmount: 0,
    finalLoanAmount: 0,
    monthlyPayment: 0,
    finalDSR: 0,
    verdict: '',
    verdictClass: '',
  };

  const rules = { salary: 100, ot: 50, commission: 50, bonus: 50, other: 50, ...promo.income_rules };
  
  // 1. Calculate total assessable income
  const avgOT = borrower.ot / (borrower.otMonths || 1);
  const avgCom = borrower.commission / (borrower.commissionMonths || 1);
  const avgOther = borrower.otherIncome / (borrower.otherIncomeMonths || 1);
  analysis.totalAssessableIncome =
    (borrower.salary || 0) * (rules.salary / 100) +
    ((borrower.bonus || 0) / 12) * (rules.bonus / 100) +
    (isFinite(avgOT) ? avgOT : 0) * (rules.ot / 100) +
    (isFinite(avgCom) ? avgCom : 0) * (rules.commission / 100) +
    (isFinite(avgOther) ? avgOther : 0) * (rules.other / 100);

  if (borrower.hasCoBorrower) {
    const coAvgOT = borrower.coBorrowerOT / (borrower.coBorrowerOTMonths || 1);
    const coAvgCom = borrower.coBorrowerCommission / (borrower.coBorrowerCommissionMonths || 1);
    const coAvgOther = borrower.coBorrowerOtherIncome / (borrower.coBorrowerOtherIncomeMonths || 1);
    const coBorrowerIncome = 
      (borrower.coBorrowerSalary || 0) * (rules.salary / 100) +
      ((borrower.coBorrowerBonus || 0) / 12) * (rules.bonus / 100) +
      (isFinite(coAvgOT) ? coAvgOT : 0) * (rules.ot / 100) +
      (isFinite(coAvgCom) ? coAvgCom : 0) * (rules.commission / 100) +
      (isFinite(coAvgOther) ? coAvgOther : 0) * (rules.other / 100);
    analysis.totalAssessableIncome += coBorrowerIncome;
  }

  // ===== เพิ่ม: นำเกณฑ์รับรู้รายได้รวมมาใช้ (Haircut) =====
  const incomeAcceptanceRatio = (promo.income_acceptance_ratio || 100) / 100;
  const finalAssessableIncome = analysis.totalAssessableIncome * incomeAcceptanceRatio;
  // =======================================================

  // 2. Determine maximum loan term
  let ageForTermCalc = borrower.age;
  if (borrower.hasCoBorrower && borrower.coBorrowerAge > 0) {
    ageForTermCalc = Math.max(borrower.age, borrower.coBorrowerAge);
  }
  const calculatedMaxTerm = Math.max(1, Math.min(
    (promo.max_loan_age || DEFAULT_MAX_AGE) - ageForTermCalc, 
    MAX_LOAN_YEARS
  ));
  analysis.maxTerm = Math.min(borrower.desiredTerm, calculatedMaxTerm);

  // 3. Calculate max affordable payment based on DSR
  const totalDebt = (borrower.debt || 0) + (borrower.hasCoBorrower ? (borrower.coBorrowerDebt || 0) : 0);
  
  // ===== แก้ไข: ใช้ finalAssessableIncome ที่ปรับลดแล้วในการคำนวณ =====
  const maxAffordablePay = (finalAssessableIncome * (DSR_CEILING / 100)) - totalDebt;
  
  if (maxAffordablePay <= 0) {
    analysis.verdict = 'ภาระหนี้สูง/รายได้ไม่พอ';
    analysis.verdictClass = 'verdict-bad';
    return analysis;
  }

  // 4. Calculate max loan amount from affordability
  let maxLoanFromAffordability;
  const calcMethod = promo.loan_calc_method || 'accurate';
  switch(calcMethod) {
    case 'multiplier':
      const multiplier = promo.multiplier || 150;
      maxLoanFromAffordability = maxAffordablePay * multiplier;
      break;
    case 'per_million':
      const perMillionRate = promo.per_million_rate || 7000;
      if (perMillionRate > 0) {
        maxLoanFromAffordability = (maxAffordablePay / perMillionRate) * 1000000;
      } else {
        maxLoanFromAffordability = 0;
      }
      break;
    case 'accurate':
    default:
      const avgRate3Y = (promo.rates?.slice(0, 3).reduce((sum, r) => sum + r.rate, 0) / Math.min(promo.rates?.length, 3)) || 3.5;
      maxLoanFromAffordability = calculateMaxLoan(maxAffordablePay, avgRate3Y, analysis.maxTerm);
  }
  analysis.maxLoanAmount = maxLoanFromAffordability;

  // 5. Apply LTV and other limits to get final loan amount
  const maxLoanFromLTV = (borrower.housePrice || 0) * ((promo.max_loan_ltv || 100) / 100);
  let finalMax = analysis.maxLoanAmount;
  if (promo.max_loan_amount_thb) {
    finalMax = Math.min(finalMax, promo.max_loan_amount_thb);
  }
  analysis.finalLoanAmount = Math.min(finalMax, maxLoanFromLTV, (borrower.housePrice || 0));
  
  if (analysis.finalLoanAmount <= 0) {
    analysis.verdict = 'วงเงินกู้ไม่เพียงพอ';
    analysis.verdictClass = 'verdict-bad';
    return analysis;
  }

  // 6. Calculate final monthly payment and DSR
  analysis.monthlyPayment = calcTiered(analysis.finalLoanAmount, promo.rates || [], analysis.maxTerm).monthly;
  // หมายเหตุ: DSR สุดท้ายจะคำนวณจากรายได้รวม 'ก่อน' หักเกณฑ์ เพื่อสะท้อนสัดส่วนหนี้ต่อรายได้ที่แท้จริง
  analysis.finalDSR = analysis.totalAssessableIncome > 0 ? ((analysis.monthlyPayment + totalDebt) / analysis.totalAssessableIncome * 100) : 0;

  // 7. Determine the final verdict
  if (analysis.finalDSR > DSR_CEILING + 5) {
    analysis.verdict = 'ภาระหนี้สูงเกิน';
    analysis.verdictClass = 'verdict-bad';
  } else if (analysis.finalLoanAmount >= (borrower.housePrice || 0) * 0.95) {
    analysis.verdict = 'แนะนำ';
    analysis.verdictClass = 'verdict-good';
  } else {
    analysis.verdict = 'เป็นไปได้';
    analysis.verdictClass = 'verdict-ok';
  }
  return analysis;
}

/**
 * Builds and displays the amortization table for the first 12 months.
 * @param {number} loanAmount Principal loan amount.
 * @param {Array<object>} tiers Tiered interest rates.
 * @param {number} years Loan term in years.
 * @param {number} monthlyPayment The calculated monthly payment.
 */
function buildAmort(loanAmount, tiers, years, monthlyPayment) {
  const tableBody = document.getElementById('amortizationTable');
  if (!tableBody) return;
  tableBody.innerHTML = '';
  if (!loanAmount || !tiers || !years || !monthlyPayment) return;

  let balance = loanAmount;
  for (let month = 1; month <= 12; month++) {
    const year = Math.ceil(month / 12);
    let currentRate = (tiers[tiers.length - 1] || { rate: 0 }).rate;
    for (const tier of tiers) {
      if (year <= tier.year) {
        currentRate = tier.rate;
        break;
      }
    }
    const monthlyRate = currentRate / 100 / 12;
    const interestPayment = balance * monthlyRate;
    const principalPayment = monthlyPayment - interestPayment;
    balance -= principalPayment;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${month}</td>
      <td>${fmt(monthlyPayment)}</td>
      <td>${fmt(principalPayment)}</td>
      <td>${fmt(interestPayment)}</td>
      <td>${fmt(Math.max(0, balance))}</td>`;
    tableBody.appendChild(row);
  }
}

/** Main function to trigger the loan calculation and analysis process. */
function calculateLoan() {
  if (!currentUser) {
    toast('กรุณาเข้าสู่ระบบก่อนใช้งาน', 'error');
    const authCard = document.getElementById('auth-card');
    if (authCard) authCard.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  // อัปเดต: ดึงข้อมูลผู้กู้ร่วมแบบเต็มรูปแบบ
  const borrower = {
    housePrice: getNumericValue('housePrice'),
    age: getNumericValue('borrowerAge'),
    desiredTerm: getNumericValue('desiredTerm') || 30,
    salary: getNumericValue('borrowerSalary'),
    bonus: getNumericValue('borrowerBonus'),
    ot: getNumericValue('borrowerOT'),
    otMonths: getNumericValue('borrowerOTMonths') || 1,
    commission: getNumericValue('borrowerCommission'),
    commissionMonths: getNumericValue('borrowerCommissionMonths') || 1,
    otherIncome: getNumericValue('borrowerOtherIncome'),
    otherIncomeMonths: getNumericValue('borrowerOtherIncomeMonths') || 1,
    debt: getNumericValue('borrowerDebt'),
    
    // ข้อมูลผู้กู้ร่วม (ฉบับสมบูรณ์)
    hasCoBorrower: document.getElementById('hasCoBorrower')?.checked || false,
    coBorrowerAge: getNumericValue('coBorrowerAge'),
    coBorrowerSalary: getNumericValue('coBorrowerSalary'),
    coBorrowerBonus: getNumericValue('coBorrowerBonus'),
    coBorrowerOT: getNumericValue('coBorrowerOT'),
    coBorrowerOTMonths: getNumericValue('coBorrowerOTMonths') || 1,
    coBorrowerCommission: getNumericValue('coBorrowerCommission'),
    coBorrowerCommissionMonths: getNumericValue('coBorrowerCommissionMonths') || 1,
    coBorrowerOtherIncome: getNumericValue('coBorrowerOtherIncome'),
    coBorrowerOtherIncomeMonths: getNumericValue('coBorrowerOtherIncomeMonths') || 1,
    coBorrowerDebt: getNumericValue('coBorrowerDebt'),
  };

  if (!borrower.housePrice || !borrower.age) return;

  const allPromos = Object.values(promoByBank).flat();
  let bestOffer = null;

  for (const promo of allPromos) {
    const analysis = runAdvancedAnalysis(promo, borrower);
    if (!bestOffer || analysis.finalLoanAmount > bestOffer.analysis.finalLoanAmount) {
      bestOffer = { promo, analysis };
    }
  }

  const detailBox = document.getElementById('bestOfferDetails');
  if (bestOffer && bestOffer.analysis.finalLoanAmount > 0) {
    document.getElementById('loanAmount').textContent = `${fmt(bestOffer.analysis.finalLoanAmount)} บาท`;
    document.getElementById('monthlyPayment').textContent = `${fmt(bestOffer.analysis.monthlyPayment)} บาท`;
    document.getElementById('bestBank').textContent = bestOffer.analysis.bankName || '-';
    document.getElementById('bestPromo').textContent = bestOffer.analysis.promoName || '-';
    document.getElementById('bestTerm').textContent = bestOffer.analysis.maxTerm || '-';
    document.getElementById('bestDSR').textContent = bestOffer.analysis.finalDSR.toFixed(1) || '-';
    detailBox.style.display = 'block';
    buildAmort(bestOffer.analysis.finalLoanAmount, bestOffer.promo.rates || [], bestOffer.analysis.maxTerm, bestOffer.analysis.monthlyPayment);
  } else {
    document.getElementById('loanAmount').textContent = '0 บาท';
    document.getElementById('monthlyPayment').textContent = '0 บาท';
    detailBox.style.display = 'flex';
    document.getElementById('amortizationTable').innerHTML = '';
  }

  compareBanks(borrower);
}



// ===== COMPACT VIEW & COMPARISON MODAL =====

/**
 * Renders the compact view for comparing all bank promotions.
 * @param {object} borrower The borrower's data.
 */
function compareBanks(borrower) {
  const container = document.getElementById('bankComparison');
  if (!container) return;
  container.innerHTML = '';

  const allPromos = Object.values(promoByBank).flat();
  if (allPromos.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#666;font-size:12px;">ไม่มีข้อมูลโปรโมชั่น</p>';
    updateCompareBar();
    return;
  }

  allPromos.forEach(promo => {
    const analysis = runAdvancedAnalysis(promo, borrower);
    const card = document.createElement('div');
    card.className = 'bank-card';
    card.style.borderLeftColor = promo.color || '#667eea';
    card.setAttribute('data-promo-id', promo.id);

    // Note: Passing the whole borrower object into an onclick in innerHTML is tricky.
    // This is a simpler approach but less robust than creating elements with createElement.
    const borrowerArgs = `${borrower.housePrice}, ${borrower.age}, ${borrower.salary}, ${borrower.bonus}, ${borrower.ot}, ${borrower.otMonths}, ${borrower.commission}, ${borrower.commissionMonths}, ${borrower.otherIncome}, ${borrower.otherIncomeMonths}, ${borrower.debt}`;

    card.innerHTML = `
      <div style="position:absolute;top:8px;right:8px">
        <label style="display:flex;gap:6px;font-size:12px;user-select:none;cursor:pointer">
          <input type="checkbox" ${selectedPromoIds.has(promo.id) ? 'checked' : ''} onchange="toggleSelectPromo('${promo.id}')"> เลือก
        </label>
      </div>
      <div class="bank-name" title="${promo.bank_name}">${promo.bank_name}</div>
      <div class="selected-promotion" title="${promo.name}">${promo.name}</div>

      <div style="margin-top:6px;font-size:12px;color:#555">วงเงินกู้ (ประมาณ)</div>
      <div style="font-size:16px;font-weight:800;color:#333">${fmt(analysis.finalLoanAmount)} บาท</div>

      <div style="margin-top:8px;font-size:12px;color:#555">ผ่อนต่อเดือน (ประมาณ)</div>
      <div style="font-size:16px;font-weight:800;color:#667eea">${fmt(analysis.monthlyPayment)} บาท</div>

      <button class="btn btn-secondary" style="margin-top:12px;width:100%" onclick="openPromoModal('${promo.id}', ${borrowerArgs})">
        ดูรายละเอียด
      </button>
    `;
    container.appendChild(card);
  });
  updateCompareBar();
}


/**
 * Opens a modal with detailed information for a single promotion.
 * @param {string} promoId The ID of the promotion to display.
 * @param {...*} borrowerArgs A list of borrower financial details.
 */
function openPromoModal(promoId, housePrice, age, salary, bonus, ot, otMonths, commission, commissionMonths, otherIncome, otherIncomeMonths, debt) {
  const promo = promosById[promoId];
  if (!promo) return;
  const borrower = { housePrice, age, salary, bonus, ot, otMonths, commission, commissionMonths, otherIncome, otherIncomeMonths, debt };
  const analysis = runAdvancedAnalysis(promo, borrower);
  const host = ensureModalHost();
  host.innerHTML = `
    <div role="dialog" aria-modal="true" style="max-width:900px;width:92%;background:#fff;border-radius:14px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div><div class="bank-name" style="margin:0">${promo.bank_name}</div><div class="selected-promotion" style="margin:0">${promo.name}</div></div>
        <button class="btn btn-danger" onclick="closeModal()">ปิด</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px">
        <div class="card" style="border:1px solid #e9ecef; margin:0;">
          <div style="font-weight:700;margin-bottom:6px">สรุปวงเงิน/ค่างวด</div>
          <div style="font-size:13px;color:#555">ระยะเวลากู้สูงสุด: ${analysis.maxTerm} ปี</div>
          <div style="font-size:13px;color:#555">วงเงินกู้ (คำนวณ): <b>${fmt(analysis.finalLoanAmount)} บาท</b></div>
          <div style="font-size:13px;color:#555">ค่างวด/เดือน (ประมาณ): <b>${fmt(analysis.monthlyPayment)} บาท</b></div>
          <div style="font-size:13px;color:#555">DSR โดยประมาณ: <b>${analysis.finalDSR.toFixed(1)}%</b></div>
        </div>
        <div class="card" style="border:1px solid #e9ecef; margin:0;">
          <div style="font-weight:700;margin-bottom:6px">โครงสร้างดอกเบี้ย</div>
          <div>${renderRatesList(promo.rates || [])}</div>
        </div>
      </div>
    </div>
  `;
  host.style.display = 'flex';
}

/**
 * Toggles the selection of a promotion for comparison.
 * @param {string} id The promotion ID to toggle.
 */
function toggleSelectPromo(id) {
  if (selectedPromoIds.has(id)) {
    selectedPromoIds.delete(id);
  } else {
    selectedPromoIds.add(id);
  }
  updateCompareBar();
  // Visually update the checkbox without a full re-render
  const checkbox = document.querySelector(`.bank-card[data-promo-id="${id}"] input[type="checkbox"]`);
  if (checkbox) checkbox.checked = selectedPromoIds.has(id);
}


/** Updates the visibility and content of the comparison bar. */
function updateCompareBar() {
  const bar = document.getElementById('compareBar');
  const count = selectedPromoIds.size;
  if (count >= 2) {
    bar.innerHTML = `
      <div style="background:#111827e6;color:#fff;border-radius:12px;padding:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;backdrop-filter:blur(6px)">
        <div style="font-size:13px">เลือกไว้ <b>${count}</b> รายการ</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-danger" onclick="clearSelection()">ล้างการเลือก</button>
          <button class="btn btn-secondary" onclick="openCompareModal()">เปรียบเทียบ</button>
        </div>
      </div>`;
    bar.style.display = 'block';
  } else if (count === 1) {
    bar.innerHTML = `
      <div style="background:#111827e6;color:#fff;border-radius:12px;padding:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;backdrop-filter:blur(6px)">
        <div style="font-size:13px">เลือก <b>1</b> รายการ (เลือกอย่างน้อย 2 รายการเพื่อเปรียบเทียบ)</div>
        <div><button class="btn btn-danger" onclick="clearSelection()">ล้างการเลือก</button></div>
      </div>`;
    bar.style.display = 'block';
  } else {
    bar.style.display = 'none';
  }
}

/** Clears the promotion selection and updates the UI. */
function clearSelection() {
    selectedPromoIds.clear();
    // Uncheck all visible checkboxes
    document.querySelectorAll('.bank-comparison input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateCompareBar();
}

/** Opens the comparison modal with the selected promotions. */
function openCompareModal() {
  if (selectedPromoIds.size < 2) return;
  const host = ensureModalHost();
  const borrower = {
    housePrice: getNumericValue('housePrice'), age: getNumericValue('borrowerAge'),
    salary: getNumericValue('borrowerSalary'), bonus: getNumericValue('borrowerBonus'),
    ot: getNumericValue('borrowerOT'), otMonths: getNumericValue('borrowerOTMonths') || 1,
    commission: getNumericValue('borrowerCommission'), commissionMonths: getNumericValue('borrowerCommissionMonths') || 1,
    otherIncome: getNumericValue('borrowerOtherIncome'), otherIncomeMonths: getNumericValue('borrowerOtherIncomeMonths') || 1,
    debt: getNumericValue('borrowerDebt'),
  };

  const promosToCompare = Array.from(selectedPromoIds).map(id => promosById[id]).filter(Boolean);
  const analyses = promosToCompare.map(p => ({ promo: p, analysis: runAdvancedAnalysis(p, borrower) }));

  const headerCols = analyses.map(({ promo }) => `<th style="min-width:220px;padding:8px 6px">${promo.bank_name}<br><span style="font-weight:400;color:#666">${promo.name}</span></th>`).join('');
  const row = (label, getValueFn) => `<tr><td style="background:#f8f9fa;font-weight:700">${label}</td>${analyses.map(a => `<td style="text-align:center">${getValueFn(a)}</td>`).join('')}</tr>`;

  host.innerHTML = `
    <div role="dialog" aria-modal="true" style="max-width:96vw;width:96vw;background:#fff;border-radius:14px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px">
        <div class="bank-name" style="margin:0">เปรียบเทียบโปรโมชั่นที่เลือก</div>
        <button class="btn btn-danger" onclick="closeModal()">ปิด</button>
      </div>
      <div style="overflow:auto;border:1px solid #e9ecef;border-radius:10px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr><th style="background:#f8f9fa;text-align:left;width:220px;padding:8px 6px">รายการ</th>${headerCols}</tr></thead>
          <tbody>
            ${row('ระยะเวลากู้สูงสุด (ปี)', a => a.analysis.maxTerm)}
            ${row('วงเงินกู้ (ประมาณ)', a => `<b>${fmt(a.analysis.finalLoanAmount)}</b> บาท`)}
            ${row('ค่างวดต่อเดือน', a => `<b style="color:#667eea">${fmt(a.analysis.monthlyPayment)}</b> บาท`)}
            ${row('DSR โดยประมาณ', a => `${a.analysis.finalDSR.toFixed(1)}%`)}
            ${row('โครงสร้างดอกเบี้ย', a => (a.promo.rates || []).map(r => `${r.year === 99 ? 'ปีถัดไป' : `ปีที่ ${r.year}`}: ${Number(r.rate).toFixed(2)}%`).join('<br>') || '<span style="color:#888">-</span>')}
          </tbody>
        </table>
      </div>
    </div>`;
  host.style.display = 'flex';
}

/**
 * An object mapping panel names to their element IDs.
 */
const resultPanelIds = {
    analysis: 'analysisResultCard',
    comparison: 'comparisonResultCard',
    amortization: 'amortizationResultCard'
};

/**
 * Hides all result panels and shows the main action buttons panel.
 */
function showActionButtons() {
  const ids = ['actionButtonsCard','analysisResultCard','comparisonResultCard','amortizationResultCard'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (id === 'actionButtonsCard') ? 'block' : 'none';
  });
}

async function initApp() {
  try {
    initSupabase();                // เตรียม client (ถ้า lib โหลดแล้ว)
    updateAuthUI(false);           // สำคัญ: ซ่อนการใช้งานทั้งหมด และโชว์การ์ดล็อกอิน

    if (supabaseClient) {
      // เตรียมข้อมูลหลังบ้านไว้ล่วงหน้า (ถ้าจำเป็น)
      await fetchBanks().catch(()=>{});
      await fetchPromotions().catch(()=>{});
      toast('เชื่อมต่อ Supabase สำเร็จ', 'success');
    }
  } catch (e) {
    console.error('initApp error:', e);
    toast('เกิดข้อผิดพลาดในการเริ่มระบบ', 'error');
  }
}
document.addEventListener('DOMContentLoaded', initApp);


/**
 * Shows a specific result panel and hides the action buttons.
 * @param {'analysis'|'comparison'|'amortization'} panelName The name of the panel to show.
 */
function showResultPanel(panelName) {
    const panelToShow = resultPanelIds[panelName];
    if (!panelToShow) return;

    // Hide action buttons and other panels first
    showActionButtons(); 
    document.getElementById('actionButtonsCard').style.display = 'none';

    // Show the selected panel
    const panelElement = document.getElementById(panelToShow);
    if (panelElement) {
        panelElement.style.display = 'block';
    }
}

// ===== APPLICATION INITIALIZATION =====

/** Force-fetches fresh data from the server. */
async function refreshPromos() {
  showSpinner('กำลังรีเฟรช...');
  await fetchBanks();
  await fetchPromotions();
  calculateLoan();
  hideSpinner();
  toast('รีเฟรชข้อมูลสำเร็จ', 'success');
}

/** Attempts to restore a user session on page load. */
async function restoreSession() {
  if (!supabaseClient) return;
  try {
    const { data } = await supabaseClient.auth.getUser();
    if (data && data.user) {
      currentUser = data.user;
      await determineAdmin();
      updateAuthUI(true);
    }
  } catch (e) {
    console.warn('Restore session failed:', e);
  }
}

/** Binds the auto-calculation logic to input fields. */
function bindAutoCalculateInputs() {
    const inputIds = [
        'housePrice', 'borrowerAge', 'borrowerSalary', 'borrowerBonus', 'borrowerOT', 
        'borrowerOTMonths', 'borrowerCommission', 'borrowerCommissionMonths', 
        'borrowerOtherIncome', 'borrowerOtherIncomeMonths', 'borrowerDebt'
    ];
    inputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const isNumericText = el.type === 'text' && el.inputMode === 'numeric';
            el.addEventListener('input', () => {
                if (isNumericText) formatNumberInput(el);
                calculateLoan();
            });
            if (isNumericText) {
                el.addEventListener('blur', () => formatNumberInput(el));
            }
        }
    });
}

/** The main function to start the application. */
async function start() {
  showSpinner('กำลังโหลดข้อมูล...');
  try {
    // Wait for the DOM to be fully loaded
    await new Promise(res => {
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', res);
      } else {
        res();
      }
    });

    // Ensure Supabase is loaded, with a small delay as fallback
    if (!window.supabase) await new Promise(r => setTimeout(r, 800));
    if (!window.supabase) throw new Error('Supabase library not loaded.');

    initSupabase();
    if (supabaseClient) toast('เชื่อมต่อ Supabase สำเร็จ', 'success');
    
    await restoreSession();
    await fetchBanks();
    await fetchPromotions();
    calculateLoan();
    bindAutoCalculateInputs();
    
    // Add mobile-specific enhancements
    initMobileEnhancements();

  } catch (e) {
    console.error('Initialization failed:', e);
    toast(e.message, 'error');
  } finally {
    hideSpinner();
    const statusEl = document.getElementById('libStatus');
    if (statusEl) statusEl.style.display = 'none';
  }
}

/** Initialize mobile-specific enhancements */
function initMobileEnhancements() {
  // Hide the library status message
  const statusEl = document.getElementById('libStatus');
  if (statusEl) statusEl.style.display = 'none';

  // Prevent zoom on input focus (iOS)
  const inputs = document.querySelectorAll('input, select, textarea');
  inputs.forEach(input => {
    input.addEventListener('focus', () => {
      if (window.innerWidth < 768) {
        const viewport = document.querySelector('meta[name=viewport]');
        if (viewport) {
          viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
        }
      }
    });
    
    input.addEventListener('blur', () => {
      if (window.innerWidth < 768) {
        const viewport = document.querySelector('meta[name=viewport]');
        if (viewport) {
          viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, user-scalable=yes');
        }
      }
    });
  });

  // Add touch feedback for buttons
  const buttons = document.querySelectorAll('.btn, .btn-secondary, .btn-danger');
  buttons.forEach(button => {
    button.addEventListener('touchstart', function() {
      this.style.opacity = '0.8';
    }, { passive: true });
    
    button.addEventListener('touchend', function() {
      setTimeout(() => {
        this.style.opacity = '1';
      }, 150);
    }, { passive: true });
  });

  // ===== ส่วนของ Swipe-to-close ที่เขียนใหม่ทั้งหมด =====
  const modalHost = document.getElementById('modalHost');
  if (!modalHost) return;

  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  let allowDragToClose = false; // ตัวแปรสำคัญ: ใช้ตรวจสอบว่าจะอนุญาตให้ลากปิดได้หรือไม่

  modalHost.addEventListener('touchstart', (e) => {
    isDragging = true;
    const target = e.target;
    const scrollableContainer = target.closest('.modal-body-scrollable');

    // ตรวจสอบว่าควรอนุญาตให้ลากปิดหรือไม่
    if (!scrollableContainer || scrollableContainer.scrollTop === 0) {
      allowDragToClose = true;
    } else {
      allowDragToClose = false;
    }
    
    startY = e.touches[0].clientY;
    currentY = startY; // Reset currentY
  }, { passive: true });

  modalHost.addEventListener('touchmove', (e) => {
    // ถ้าไม่อนุญาตให้ลาก หรือไม่ได้กำลังลากอยู่ ให้หยุดทำงานทันที
    if (!isDragging || !allowDragToClose) return;

    currentY = e.touches[0].clientY;
    const diffY = currentY - startY;
    
    // ทำให้ลากลงได้อย่างเดียว
    if (diffY > 0 && window.innerWidth < 768) {
      // ไม่ให้ event การเลื่อน scroll ทำงานทับซ้อนกัน
      e.preventDefault(); 
      const modal = modalHost.querySelector('div[role="dialog"]');
      if (modal) {
        modal.style.transition = 'none'; // ปิด transition ตอนลาก
        modal.style.transform = `translateY(${diffY}px)`;
        modal.style.opacity = Math.max(1 - diffY / 300, 0.5);
      }
    }
  }, { passive: false }); // เปลี่ยนเป็น false เพื่อให้ preventDefault() ทำงานได้

  modalHost.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    
    // ถ้าไม่เคยได้รับอนุญาตให้ลาก ก็ไม่ต้องทำอะไรต่อ
    if (!allowDragToClose) return;

    const diffY = currentY - startY;
    const modal = modalHost.querySelector('div[role="dialog"]');
    
    if (diffY > 80 && window.innerWidth < 768) { // ลดระยะที่ต้องลากลงเล็กน้อย
      closeModal();
    } else if (modal) {
      // ทำให้ Modal เด้งกลับที่เดิม
      modal.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
      modal.style.transform = '';
      modal.style.opacity = '';
    }

    // รีเซ็ตสถานะ
    allowDragToClose = false;
  }, { passive: true });
}
  
  

  // Improve modal behavior on mobile
  const modalHost = document.getElementById('modalHost');
  if (modalHost) {
    modalHost.addEventListener('touchstart', (e) => {
      if (e.target === modalHost) {
        closeModal();
      }
    }, { passive: true });
  }

  // Add swipe-to-close for modals on mobile
  let startY = 0;
  let currentY = 0;
  let isDragging = false;

  modalHost?.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    isDragging = true;
  }, { passive: true });

  modalHost?.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const diffY = currentY - startY;
    
    if (diffY > 0 && window.innerWidth < 768) {
      const modal = modalHost.querySelector('div');
      if (modal) {
        modal.style.transform = `translateY(${Math.min(diffY, 100)}px)`;
        modal.style.opacity = Math.max(1 - diffY / 200, 0.5);
      }
    }
  }, { passive: true });

  modalHost?.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    
    const diffY = currentY - startY;
    const modal = modalHost.querySelector('div');
    
    if (diffY > 100 && window.innerWidth < 768) {
      closeModal();
    } else if (modal) {
      modal.style.transform = '';
      modal.style.opacity = '';
    }
  }, { passive: true });


// เพิ่มบรรทัดนี้ที่ท้ายสุดของไฟล์
start();
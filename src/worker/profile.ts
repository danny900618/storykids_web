// 報名資料欄位檢查：線上報名與後台「編輯報名資料」共用
import { DIETS, GENDERS, GRADES } from './env';

export interface Profile {
  student_name: string;
  gender: string;
  school: string;
  grade: string;
  parent_name: string;
  tel: string; // 聯絡電話（市話）
  phone: string; // 行動電話
  email: string;
  diet: string;
  zip: string;
  address: string;
  note: string;
}

// 欄位中文名稱（後台操作紀錄顯示用）
export const PROFILE_LABELS: Record<keyof Profile, string> = {
  student_name: '學生姓名',
  gender: '性別',
  school: '就讀學校',
  grade: '年級',
  parent_name: '家長姓名',
  tel: '聯絡電話',
  phone: '行動電話',
  email: 'Email',
  diet: '飲食習慣',
  zip: '郵遞區號',
  address: '地址',
  note: '備註',
};

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function readProfile(body: Record<string, unknown>): Profile {
  return {
    student_name: clean(body.student_name, 30),
    gender: clean(body.gender, 4),
    school: clean(body.school, 50),
    grade: clean(body.grade, 20),
    parent_name: clean(body.parent_name, 30),
    tel: clean(body.tel, 20),
    phone: clean(body.phone, 20).replace(/[\s-]/g, ''),
    email: clean(body.email, 100),
    diet: clean(body.diet, 10),
    zip: clean(body.zip, 6),
    address: clean(body.address, 100),
    note: clean(body.note, 500),
  };
}

// mode = 'register'：線上報名，舊站的必填欄位都要填
// mode = 'admin'：後台修改，只要求資料表必填的欄位（舊站匯入的資料可能缺郵遞區號等）
// previous（後台修改時傳入原本的資料）：格式只檢查「這次有修改」的欄位，原本就不合格式的舊資料不會擋住存檔
export function validateProfile(p: Profile, mode: 'register' | 'admin', previous?: Partial<Record<keyof Profile, string | null>>): string[] {
  const errors: string[] = [];
  const strict = mode === 'register';
  const unchanged = (key: keyof Profile) => !!previous && (previous[key] ?? '') === p[key];
  if (!p.student_name) errors.push('請填寫學生姓名');
  if (strict && !GENDERS.includes(p.gender)) errors.push('請選擇性別');
  if (!strict && p.gender && !unchanged('gender') && !GENDERS.includes(p.gender)) errors.push('性別只能是男或女');
  if (strict && !p.school) errors.push('請填寫就讀學校');
  if (strict && !GRADES.includes(p.grade)) errors.push('請選擇目前就讀年級');
  if (!strict && p.grade && !unchanged('grade') && !GRADES.includes(p.grade)) errors.push('年級不正確');
  if (!p.parent_name) errors.push('請填寫家長姓名');
  if (p.tel && !unchanged('tel') && !/^[\d\s()#+-]{6,20}$/.test(p.tel)) errors.push('聯絡電話格式不正確（範例：04-23196868）');
  if (!p.phone || (!unchanged('phone') && !/^09\d{8}$/.test(p.phone))) errors.push('請填寫正確的行動電話（09 開頭共 10 碼）');
  if (!p.email || (!unchanged('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))) errors.push('請填寫正確的 Email');
  // 線上報名只能選表單上的選項；後台保留舊站資料原本的寫法（例如「素」「無」）
  if (strict && p.diet && !DIETS.includes(p.diet)) errors.push('飲食習慣選項不正確');
  if (strict && !/^\d{3,6}$/.test(p.zip)) errors.push('請填寫郵遞區號（3 或 5 碼）');
  if (!strict && p.zip && !unchanged('zip') && !/^\d{3,6}$/.test(p.zip)) errors.push('郵遞區號格式不正確（3 或 5 碼數字）');
  if (strict && !p.address) errors.push('請填寫地址');
  return errors;
}

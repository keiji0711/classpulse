import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Building2, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

const LOGO_BUCKET = 'school-logos';
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

interface SchoolBranding {
  id: string;
  name: string;
  deped_school_id: string | null;
  logo_url: string | null;
}

function objectPathFromLogoValue(value: string | null): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value;
  const marker = `/storage/v1/object/public/${LOGO_BUCKET}/`;
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) return null;

  try {
    return decodeURIComponent(value.slice(markerIndex + marker.length).split('?')[0]);
  } catch {
    return null;
  }
}

function publicLogoUrl(value: string | null): string | null {
  const objectPath = objectPathFromLogoValue(value);
  if (!objectPath) return null;
  if (value && /^https?:\/\//i.test(value)) return value;
  return supabase.storage.from(LOGO_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

export default function SchoolBrandingPanel() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [school, setSchool] = useState<SchoolBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.school_id || user.role !== 'school_admin') {
      setLoading(false);
      return;
    }

    let active = true;
    void supabase
      .from('schools')
      .select('id, name, deped_school_id, logo_url')
      .eq('id', user.school_id)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) showToast(error.message, 'error');
        else setSchool(data as SchoolBranding);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [showToast, user?.role, user?.school_id]);

  async function setLogoPath(logoPath: string | null) {
    const { error } = await supabase.rpc('update_own_school_logo', {
      p_logo_path: logoPath,
    });
    if (error) throw error;
  }

  async function removeStoredLogo(url: string | null) {
    const objectPath = objectPathFromLogoValue(url);
    if (!objectPath) return;
    await supabase.storage.from(LOGO_BUCKET).remove([objectPath]);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !school) return;

    const extension = EXTENSIONS[file.type];
    if (!extension) {
      showToast('Choose a PNG, JPG, or WebP image.', 'error');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      showToast('The school logo must be 2 MB or smaller.', 'error');
      return;
    }

    setSaving(true);
    const previousUrl = school.logo_url;
    const objectPath = `${school.id}/logo-${Date.now()}.${extension}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(objectPath, file, {
          cacheControl: '31536000',
          contentType: file.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      try {
        await setLogoPath(objectPath);
      } catch (error) {
        await supabase.storage.from(LOGO_BUCKET).remove([objectPath]);
        throw error;
      }

      setSchool({ ...school, logo_url: objectPath });
      await removeStoredLogo(previousUrl);
      showToast('School logo updated. It will appear in the mobile app.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not upload the school logo.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!school?.logo_url || saving) return;
    setSaving(true);
    const previousUrl = school.logo_url;

    try {
      await setLogoPath(null);
      setSchool({ ...school, logo_url: null });
      await removeStoredLogo(previousUrl);
      showToast('School logo removed. ClassPulse will use the default icon.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not remove the school logo.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass-panel rounded-2xl p-5 space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Building2 size={18} />
        </span>
        <div>
          <h3 className="text-lg font-semibold text-slate-800">School Branding</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Upload the official logo shown to teachers and families in the mobile app.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-28 items-center justify-center text-primary">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : school ? (
        <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-5 sm:flex-row sm:items-center">
          <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {school.logo_url ? (
              <img src={publicLogoUrl(school.logo_url) ?? undefined} alt={`${school.name} logo`} className="h-full w-full object-contain p-2" />
            ) : (
              <Building2 size={42} className="text-slate-300" aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-800">{school.name}</p>
            <p className={`mt-1 text-xs font-semibold ${school.deped_school_id ? 'text-slate-500' : 'text-amber-600'}`}>
              {school.deped_school_id ? `DepEd School ID: ${school.deped_school_id}` : 'DepEd School ID is not configured. SF1 imports are locked.'}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              PNG, JPG, or WebP up to 2 MB. A square image with a transparent or white background works best.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => void handleFileChange(event)}
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 hover:bg-primary-dark disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <ImagePlus size={16} />}
                {school.logo_url ? 'Replace Logo' : 'Upload Logo'}
              </button>
              {school.logo_url && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleRemove()}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 size={16} />
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">No school is assigned to this administrator account.</p>
      )}
    </section>
  );
}

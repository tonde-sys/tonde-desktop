// ============================================================
// TONDE DESKTOP — LoginPage
// Connexion agent — Dark Fintech Minimal
// ============================================================

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/authStore";
import { useOfflineStore } from "../store/offlineStore";
import { API_HOST, IS_MOCK_MODE } from "../config/api";
import { Eye, EyeOff, LogIn } from "lucide-react";
import pkg from "../../package.json";

const loginSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { t } = useTranslation();
  const { login, isLoading, isWaking, error, clearError } = useAuthStore();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    clearError();
    await login(data);
  };

  return (
    <div className="h-screen bg-midnight flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="mb-10 text-center">
        <img
          src="/logo/tonde-logo.png"
          alt={t("app.name")}
          className="w-28 h-28 rounded-[28px] mx-auto mb-4 shadow-[0_0_60px_rgba(108,71,255,0.35)]"
        />
        <h1 className="font-mono font-bold text-5xl text-violet tracking-widest mb-2">
          TONDE
        </h1>
        <p className="text-text-secondary text-sm">{t("app.tagline")}</p>
      </div>

      {/* Card login */}
      <div className="card w-full max-w-sm">
        <h2 className="text-text-primary font-semibold text-lg mb-6">
          {t("auth.login")}
        </h2>

        {/* Erreur globale */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-rose/10 border border-rose/30 rounded-btn text-rose text-sm">
            {error}
          </div>
        )}

        {/* Poste sans Internet : la connexion reprendra seule */}
        {!isOnline && (
          <div className="mb-4 px-4 py-3 bg-amber/10 border border-amber/30 rounded-btn text-amber text-sm">
            {t("auth.offlineNotice")}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label className="text-text-secondary text-sm">
              {t("auth.email")}
            </label>
            <input
              {...register("email")}
              type="email"
              autoComplete="email"
              className="bg-obsidian border border-border-subtle rounded-btn px-4 py-2.5
                text-text-primary text-sm placeholder-text-muted
                focus:outline-none focus:border-violet transition-colors"
              placeholder="agent@banque.bi"
            />
            {errors.email && (
              <span className="text-rose text-xs">{errors.email.message}</span>
            )}
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label className="text-text-secondary text-sm">
              {t("auth.password")}
            </label>
            <div className="relative">
              <input
                {...register("password")}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="w-full bg-obsidian border border-border-subtle rounded-btn px-4 py-2.5 pr-10
                  text-text-primary text-sm placeholder-text-muted
                  focus:outline-none focus:border-violet transition-colors"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && (
              <span className="text-rose text-xs">{errors.password.message}</span>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="btn-primary flex items-center justify-center gap-2 mt-2"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {isWaking ? t("auth.wakingServer") : t("auth.loggingIn")}
              </>
            ) : (
              <>
                <LogIn size={16} />
                {t("auth.loginButton")}
              </>
            )}
          </button>
        </form>
      </div>

      {/* Version + serveur */}
      <p className="mt-8 text-text-muted text-xs text-center">
        v{pkg.version}
        <span className="block mt-1">
          {IS_MOCK_MODE
            ? t("auth.mockServer")
            : t("auth.server", { host: API_HOST })}
        </span>
        {!IS_MOCK_MODE && (
          <span className="block mt-0.5">{t("auth.coldStart")}</span>
        )}
      </p>
    </div>
  );
}

import { AuthFailure } from "@/app/(auth)/_components/failures";
import { PasswordMeter } from "@/app/(auth)/_components/NewPasswordField";
import { OtpField } from "@/app/(auth)/_components/OtpField";
import { ResendButton } from "@/app/(auth)/_components/ResendButton";
import { SignUpForm } from "@/app/(auth)/_components/SignUpForm";
import { Button } from "@/components/primitives";
import { Card } from "@/components/structure";
import { assessPassword } from "@/lib/auth/password-policy";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";

/**
 * Board `7a` — auth, four states and the failures they carry.
 *
 * Every refusal the four screens can print, side by side, because they are the
 * screens most people meet on their worst day with the product: the tones are
 * the board's (expired `bad`, locked `warn`, suspended `neutral`), and a
 * suspended notice with a date or a reason in it is the defect this section is
 * here to catch.
 */
export function AuthGallery() {
  return (
    <Section
      id="auth"
      title="Auth"
      note="Board 7a. Password first as drawn, the code one button below; a password lockout leaves the code path open; suspended points at the email and shows nothing else."
    >
      <States label="Reset · link expired" stack>
        <AuthFailure error="link_expired" restartHref="/reset" />
      </States>
      <States label="Sign in · password locked" stack>
        <AuthFailure error="password_locked" retry="840" restartHref="/signin" />
      </States>
      <States label="Verify · codes locked" stack>
        <AuthFailure error="too_many_attempts" retry="540" restartHref="/signin" />
      </States>
      <States label="Any · suspended" stack>
        <AuthFailure error="suspended" restartHref="/signin" />
      </States>
      <States label="Verify · wrong code, attempts left" stack>
        <AuthFailure error="code_incorrect" left="3" restartHref="/signin" />
      </States>
      <States label="Sign in · wrong password, one left" stack>
        <AuthFailure error="password_incorrect" left="1" restartHref="/signin" />
      </States>
      <States label="Sign in · mobiles unreachable" stack>
        <AuthFailure error="sms_unavailable" restartHref="/signin" />
      </States>
      <States label="Sign up · mobile on another account" stack>
        <AuthFailure error="phone_taken" restartHref="/signup" />
      </States>
      <States label="Resend · cooldown" stack>
        <AuthFailure error="cooldown" retry="24" restartHref="/signin" />
      </States>

      <States label="Code · empty">
        <OtpField label="Verification code" length={6} />
      </States>
      <States label="Code · wrong">
        <OtpField label="Verification code, wrong" length={6} invalid />
      </States>
      <States label="Code · locked">
        <OtpField label="Verification code, locked" length={6} disabled hint={t("auth.locked.help")} />
      </States>
      <States label="Resend · counting / ready">
        <ResendButton initialSeconds={24}>
          <Button type="button" variant="ghost" size="sm">{t("auth.verify.resend")}</Button>
        </ResendButton>
        <ResendButton initialSeconds={0}>
          <Button type="button" variant="ghost" size="sm">{t("auth.verify.resend")}</Button>
        </ResendButton>
      </States>

      <States label="Password · too short" stack>
        <div className="w-80"><PasswordMeter assessment={assessPassword("harbour")} /></div>
      </States>
      <States label="Password · strong, as drawn" stack>
        <div className="w-80"><PasswordMeter assessment={assessPassword("harbourcrane")} /></div>
      </States>
      <States label="Password · very strong" stack>
        <div className="w-80"><PasswordMeter assessment={assessPassword("harbour crane at jebel ali")} /></div>
      </States>
      <States label="Password · long and worthless" stack>
        <div className="w-80"><PasswordMeter assessment={assessPassword("123456789012")} /></div>
      </States>

      {/*
        One form, not two. An unnamed form is a landmark to the landmarks check,
        and two on one page are a duplicate — the empty state is /signup itself.
      */}
      <States label="Sign up · refused, values kept" stack>
        <div className="max-w-[40rem]">
          <Card padded>
          <SignUpForm
            initial={{
              values: { fullName: "Suresh Menon", phone: "+971 50 641 2288", email: "suresh@alwaha.ae", intent: "listing" },
              termsAccepted: false,
              error: "terms_required",
              retry: null,
              limit: null,
            }}
            next={null}
            autoFocus={false}
          />
          </Card>
        </div>
      </States>
    </Section>
  );
}

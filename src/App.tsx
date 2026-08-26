import { AppMark } from './components/AppMark';
import { AppShell } from './components/AppShell';
import { SetupNotice } from './components/SetupNotice';
import { SignInScreen } from './components/SignInScreen';
import { UpdateBar } from './components/UpdateBar';
import { isFirebaseConfigured } from './firebase';
import { useAuthUser } from './hooks/useAuthUser';

function Screen() {
  const { user, loading } = useAuthUser();

  if (!isFirebaseConfigured) {
    return <SetupNotice />;
  }

  if (loading) {
    return (
      <main className="screen screen--centred">
        <div className="splash">
          <AppMark size={56} />
          <p className="splash__label">Opening your deck…</p>
        </div>
      </main>
    );
  }

  return user ? <AppShell user={user} /> : <SignInScreen />;
}

export function App() {
  return (
    <>
      <UpdateBar />
      <Screen />
    </>
  );
}

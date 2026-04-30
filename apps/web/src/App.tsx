import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Login } from './pages/Login';
import { CliAuth } from './pages/CliAuth';
import { Home } from './pages/Home';
import { Village } from './pages/Village';
import { Dashboard } from './pages/Dashboard';
import { Achievements } from './pages/Achievements';
import { Capture } from './pages/Capture';
import { Masters } from './pages/Masters';
import { Villages as MastersVillages } from './pages/masters/Villages';
import { Schools as MastersSchools } from './pages/masters/Schools';
import { Events as MastersEvents } from './pages/masters/Events';
import { Qualifications as MastersQualifications } from './pages/masters/Qualifications';
import { Manuals as MastersManuals } from './pages/masters/Manuals';
import { Users as MastersUsers } from './pages/masters/Users';
import { Ponds } from './pages/Ponds';
import { PondNew } from './pages/PondNew';
import { PondDetail } from './pages/PondDetail';
import { TrainingManuals } from './pages/TrainingManuals';
import { Outbox } from './pages/Outbox';
import { Shell } from './pages/Shell';
import { ForceUpgradeBanner, UpdateAvailableBanner } from './lib/sync-state';
import { can } from './api';

export function App() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-fg">
        Loading…
      </div>
    );
  }
  if (!user) {
    return (
      <>
        <ForceUpgradeBanner />
        <UpdateAvailableBanner />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/cli-auth" element={<CliAuth />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </>
    );
  }
  // L3.1 Master Creations is Super-Admin only (via `user.write` cap).
  // Non-admins reaching `/masters` get bounced back to the Home —
  // the route is also hidden from the nav for the same audience.
  const canMasters = can(user, 'user.write');
  // L3.3 Jal Vriddhi pond agreements (§3.10). Read tier: every
  // authenticated user has `pond.read`. Write tier (the create form):
  // VC / AF / Cluster / Super only — gated server-side too.
  const canPondsRead = can(user, 'pond.read');
  const canPondsWrite = can(user, 'pond.write');
  return (
    <Shell>
      <ForceUpgradeBanner />
      <UpdateAvailableBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/cli-auth" element={<CliAuth />} />
        <Route path="/village/:id" element={<Village />} />
        <Route path="/capture" element={<Capture />} />
        <Route path="/achievements" element={<Achievements />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/training-manuals" element={<TrainingManuals />} />
        <Route path="/outbox" element={<Outbox />} />
        {canMasters && <Route path="/masters" element={<Masters />} />}
        {canMasters && <Route path="/masters/villages" element={<MastersVillages />} />}
        {canMasters && <Route path="/masters/schools" element={<MastersSchools />} />}
        {canMasters && <Route path="/masters/events" element={<MastersEvents />} />}
        {canMasters && <Route path="/masters/qualifications" element={<MastersQualifications />} />}
        {canMasters && <Route path="/masters/manuals" element={<MastersManuals />} />}
        {canMasters && <Route path="/masters/users" element={<MastersUsers />} />}
        {canPondsRead && <Route path="/ponds" element={<Ponds />} />}
        {canPondsWrite && <Route path="/ponds/new" element={<PondNew />} />}
        {canPondsRead && <Route path="/ponds/:id" element={<PondDetail />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

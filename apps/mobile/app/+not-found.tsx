import { Redirect } from 'expo-router';

/** Naməlum route-lar "Unmatched Route" əvəzinə ana səhifəyə yönlənsin. */
export default function NotFound() {
  return <Redirect href="/" />;
}

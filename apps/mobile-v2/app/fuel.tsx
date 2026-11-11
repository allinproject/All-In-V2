import { useLocalSearchParams } from 'expo-router';
import { V2WorkspaceEntry } from '../src/navigation/V2WorkspaceEntry';
import { fuelContextDescription, parseFuelDayContext } from '../src/features/today/todayFuelNavigation';

export default function FuelScreen() {
  const params = useLocalSearchParams<{ date?: string; section?: string }>();
  const context = parseFuelDayContext(params.date, params.section);
  return <V2WorkspaceEntry title="Fuel" contextDescription={fuelContextDescription(context)} />;
}

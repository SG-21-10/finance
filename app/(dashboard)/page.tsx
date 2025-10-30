import { UserButton } from '@clerk/nextjs'; // Assuming UserButton might be used elsewhere or in WelcomeMsg

import { DataGrid } from '@/components/data-grid';
import { DataCharts } from '@/components/data-charts';

import { RecommendationsCard } from '@/components/recommendations-card'; // <-- Import the new card

export default function DashboardPage() {
  return (
    <div className="max-w-screen-2xl mx-auto w-full pb-10 -mt-24">
      {/* Assuming WelcomeMsg should be here */}
     
      <DataGrid />
      <DataCharts />
      {/* Add the recommendations card below the charts */}
      <div className="mt-8">
         <RecommendationsCard />
      </div>
    </div>
  );
}



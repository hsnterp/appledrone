import { useState, useEffect, useRef } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Apple, Circle, Info, ChevronLeft, ChevronRight } from 'lucide-react';

// API base URL - change this if your Flask server runs on a different port
const API_BASE_URL = 'http://localhost:5000/api';

const Dashboard = () => {
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedFruitIndex, setSelectedFruitIndex] = useState(0);
  const [fruitRipenessData, setFruitRipenessData] = useState({});
  const [sessionId, setSessionId] = useState('test_session_002'); // Default session ID
  const videoRef = useRef(null);

  const fruits = ['apple', 'banana', 'mango'];
  const selectedFruit = fruits[selectedFruitIndex];

  const handlePrevFruit = () => {
    setSelectedFruitIndex((prev) => (prev === 0 ? fruits.length - 1 : prev - 1));
  };

  const handleNextFruit = () => {
    setSelectedFruitIndex((prev) => (prev === fruits.length - 1 ? 0 : prev + 1));
  };

  // Fetch fruit-specific ripeness data
  useEffect(() => {
    const fetchFruitRipeness = async (fruitType) => {
      try {
        const response = await fetch(`${API_BASE_URL}/fruit/${fruitType}/ripeness`);
        if (!response.ok) throw new Error(`Failed to fetch ${fruitType} ripeness data`);
        const data = await response.json();
        return data;
      } catch (err) {
        console.error(`Error fetching ${fruitType} ripeness:`, err);
        return { ripe: 0, unripe: 0, overripe: 0, total: 0 };
      }
    };

    const loadAllFruitRipeness = async () => {
      const ripenessData = {};
      for (const fruit of fruits) {
        ripenessData[fruit] = await fetchFruitRipeness(fruit);
      }
      setFruitRipenessData(ripenessData);
    };

    if (sessionData) {
      loadAllFruitRipeness();
    }
  }, [sessionData]);

  // Fetch session data from Flask backend
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch session stats
        const response = await fetch(`${API_BASE_URL}/session/${sessionId}/stats`);
        if (!response.ok) {
          throw new Error('Failed to fetch session data');
        }

        const data = await response.json();

        // Add mock values for fields not yet in API
        const enhancedData = {
          ...data,
          sessionStats: {
            ...data.sessionStats,
            dateRange: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            changeFromLastSession: 0 // This would need to be calculated from comparing sessions
          }
        };

        setSessionData(enhancedData);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [sessionId]);
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-white">
        <div className="text-red-600 text-xl mb-4">Error loading data</div>
        <div className="text-gray-600">{error}</div>
        <div className="text-sm text-gray-500 mt-4">Make sure the Flask server is running on port 5000</div>
      </div>
    );
  }

  if (!sessionData) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="text-gray-600">No session data available</div>
      </div>
    );
  }
  
  const COLORS = {
    ripe: '#4ade80',
    unripe: '#facc15',
    overripe: '#f87171'
  };
  
  const FRUIT_COLORS = {
    apple: '#f87171',
    mango: '#fbbf24',
    banana: '#facc15'
  };
  
  const totalFruits = sessionData.fruitCounts.reduce((acc, curr) => acc + curr.value, 0);
  
  // Donut chart data
  const fruitDonutData = sessionData.fruitCounts.map(item => ({
    name: item.name,
    value: item.value,
    percent: totalFruits > 0 ? Math.round((item.value / totalFruits) * 100) : 0
  }));
  
  // Calculate total count for ripeness
  const totalRipeness = sessionData.ripenessDistribution.reduce((acc, curr) => acc + curr.value, 0);
  
  return (
    <div className="bg-white text-gray-800" style={{ minHeight: '100vh', width: '100%', overflowY: 'scroll', paddingBottom: '100px' }}>
      {/* Header - Full Width */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 shadow-sm">
        <div className="flex justify-between items-center w-full px-4">
          <div className="flex items-center space-x-3">
            <Apple size={24} className="text-blue-600" />
            <h1 className="text-xl font-bold text-gray-900">FruitScan</h1>
          </div>
          <div className="bg-gray-100 text-sm text-gray-600 px-4 py-2 rounded-md">
            {sessionData.sessionStats.dateRange}
          </div>
        </div>
      </header>
      
      <main className="w-full px-8 py-8">
        <div className="mb-8 px-4">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Harvest Overview</h2>
          <p className="text-gray-500 text-sm">Latest drone scan session summary and insights</p>
        </div>
        
        {/* Stats Overview - Full Width */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10 px-4">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-4">
              <div className="text-gray-500 text-sm">Total Fruits</div>
              <div className="bg-blue-100 p-2 rounded-lg">
                <Apple size={20} className="text-blue-600" />
              </div>
            </div>
            <div className="flex items-baseline">
              <div className="text-4xl font-bold text-gray-800">{totalFruits}</div>
              <div className="ml-2 flex items-center text-green-600 text-sm">
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path>
                </svg>
                {sessionData.sessionStats.changeFromLastSession}%
              </div>
            </div>
            <div className="mt-1 text-gray-400 text-xs">from previous scan</div>
          </div>
          
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-4">
              <div className="text-gray-500 text-sm">Ripe Fruits</div>
              <div className="bg-green-100 p-2 rounded-lg">
                <Circle size={20} className="text-green-600" />
              </div>
            </div>
            <div className="text-4xl font-bold text-gray-800">
              {sessionData.ripenessDistribution.find(r => r.name === 'Ripe')?.value || 0}
            </div>
            <div className="mt-1 text-gray-400 text-xs">ready for harvest</div>
          </div>
          
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-4">
              <div className="text-gray-500 text-sm">Uncertain Detections</div>
              <div className="bg-amber-100 p-2 rounded-lg">
                <Info size={20} className="text-amber-600" />
              </div>
            </div>
            <div className="text-4xl font-bold text-gray-800">
              {sessionData.uncertainDetections.length}
            </div>
            <div className="mt-1 text-gray-400 text-xs">needs review</div>
          </div>
        </div>
        
        {/* Charts Row - Full Width */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 px-4">
          {/* Fruit Distribution Chart */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Fruit Distribution</h3>
            </div>
            <div className="flex flex-col items-center justify-center" style={{ height: "400px" }}>
              <div style={{ width: '100%', height: '85%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={fruitDonutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={110}
                      fill="#8884d8"
                      paddingAngle={5}
                      dataKey="value"
                      label={({name, percent}) => `${name}: ${percent}%`}
                    >
                      {fruitDonutData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={Object.values(FRUIT_COLORS)[index % Object.values(FRUIT_COLORS).length]} 
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              
              {/* Chart Legend */}
              <div className="flex justify-center space-x-8 mt-4">
                {Object.entries(FRUIT_COLORS).map(([key, color]) => (
                  <div key={key} className="flex items-center">
                    <div className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: color }}></div>
                    <div className="text-sm text-gray-600 capitalize">{key}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Ripeness Distribution */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Ripeness Distribution</h3>
            </div>
            <div className="flex flex-col items-center justify-center" style={{ height: "400px" }}>
              <div style={{ width: '100%', height: '85%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sessionData.ripenessDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={110}
                      fill="#8884d8"
                      paddingAngle={5}
                      dataKey="value"
                      label={({name, value}) => `${name}: ${value}`}
                    >
                      {sessionData.ripenessDistribution.map((entry, index) => {
                        const ripeness = entry.name.toLowerCase();
                        return (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={COLORS[ripeness] || `#${Math.floor(Math.random()*16777215).toString(16)}`} 
                          />
                        );
                      })}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              
              {/* Chart Legend */}
              <div className="flex justify-center space-x-8 mt-4">
                {Object.entries(COLORS).map(([key, color]) => (
                  <div key={key} className="flex items-center">
                    <div className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: color }}></div>
                    <div className="text-sm text-gray-600 capitalize">{key}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        
        {/* Video Section with Fruit Stats */}
        <div className="mt-10 px-4">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Video with Navigation - Left Side (Smaller) */}
            <div className="lg:col-span-2 flex items-center justify-center space-x-2">
              {/* Left Arrow */}
              <button 
                onClick={handlePrevFruit}
                className="bg-white p-2 rounded-full shadow-lg hover:bg-gray-100 transition-colors border border-gray-200 flex-shrink-0"
              >
                <ChevronLeft size={24} className="text-gray-700" />
              </button>
              
              {/* Video */}
              <div className="flex-1 bg-white">
                <video 
                  key={selectedFruit}
                  ref={videoRef}
                  src={`/${selectedFruit}animation.mp4`}
                  autoPlay
                  muted
                  className="w-full rounded-lg"
                  style={{ maxHeight: '300px' }}
                >
                  Your browser does not support the video tag.
                </video>
              </div>
              
              {/* Right Arrow */}
              <button 
                onClick={handleNextFruit}
                className="bg-white p-2 rounded-full shadow-lg hover:bg-gray-100 transition-colors border border-gray-200 flex-shrink-0"
              >
                <ChevronRight size={24} className="text-gray-700" />
              </button>
            </div>
            
            {/* Fruit Statistics - Right Side (Wider) */}
            <div className="lg:col-span-3 bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <div className="flex items-center space-x-2 mb-6">
                {selectedFruit === 'apple' && <Apple size={20} className="text-red-500" />}
                {selectedFruit === 'banana' && <span className="text-2xl">🍌</span>}
                {selectedFruit === 'mango' && <span className="text-2xl">🥭</span>}
                <h3 className="text-lg font-semibold text-gray-800 capitalize">{selectedFruit} Ripeness</h3>
              </div>
              
              <div className="space-y-4">
                <div className="border-b border-gray-100 pb-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">Ripe</span>
                    <span className="text-2xl font-bold text-green-600">
                      {fruitRipenessData[selectedFruit]?.ripe || 0}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{
                        width: `${fruitRipenessData[selectedFruit]?.total > 0
                          ? (fruitRipenessData[selectedFruit].ripe / fruitRipenessData[selectedFruit].total) * 100
                          : 0}%`
                      }}
                    ></div>
                  </div>
                </div>

                <div className="border-b border-gray-100 pb-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">Unripe</span>
                    <span className="text-2xl font-bold text-yellow-600">
                      {fruitRipenessData[selectedFruit]?.unripe || 0}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-yellow-400 h-2 rounded-full"
                      style={{
                        width: `${fruitRipenessData[selectedFruit]?.total > 0
                          ? (fruitRipenessData[selectedFruit].unripe / fruitRipenessData[selectedFruit].total) * 100
                          : 0}%`
                      }}
                    ></div>
                  </div>
                </div>

                <div className="pb-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">Overripe</span>
                    <span className="text-2xl font-bold text-red-600">
                      {fruitRipenessData[selectedFruit]?.overripe || 0}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full"
                      style={{
                        width: `${fruitRipenessData[selectedFruit]?.total > 0
                          ? (fruitRipenessData[selectedFruit].overripe / fruitRipenessData[selectedFruit].total) * 100
                          : 0}%`
                      }}
                    ></div>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-gray-100">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500 capitalize">Total {selectedFruit}s</span>
                  <span className="text-3xl font-bold text-gray-800">
                    {fruitRipenessData[selectedFruit]?.total || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
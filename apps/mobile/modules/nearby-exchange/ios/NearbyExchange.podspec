Pod::Spec.new do |s|
  s.name           = 'NearbyExchange'
  s.version        = '1.0.0'
  s.summary        = 'Nearby device discovery and distance measurement (issue #698 spike)'
  s.description    = 'Discovers nearby devices over Bonjour/peer-to-peer Wi-Fi (Network framework) and measures distance with Nearby Interaction (UWB).'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
